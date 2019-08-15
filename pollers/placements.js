"use strict";

/******************************************************************************************

Placements poller

******************************************************************************************/

const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");
const _ = require("lodash");
const uuid = require("uuid/v1");
const mkdirp = require("mkdirp");
const csvparser = require("csv-parser");
const stream = require("stream");
const firstChunkStream = require("first-chunk-stream");
const isUtf8 = require("is-utf8");
const nodemailer = require("nodemailer");
const ta = require("time-ago");

const datastore = require("../datastore/main").createOrGet();
const workers = require("../common/workers.js");
const contacts = require("../common/contacts.js");
const consultants = require("../common/consultants.js");
const sites = require("../common/sites.js");
const positions = require("../common/positions.js");
const businesses = require("../common/businesses.js");
const placements = require("../common/placements.js");

let log = null;

const sendEmails = !!process.env.SMTP_HOST;
let transporter = null;

function initialiseSMTP() {
	log.info(`Creating SMTP connection to ${ process.env.SMTP_HOST }:${ process.env.SMTP_PORT }`);

	// Set up our smtp transport
	transporter = nodemailer.createTransport({
		pool: true,
		host: process.env.SMTP_HOST,
		port: process.env.SMTP_PORT,
		secure: false
		//secure: !!process.env.SMTP_USERNAME // enable TLS if required
	});
	
	if (process.env.SMTP_USERNAME) {
		log.info(`Using username: ${ !!process.env.SMTP_USERNAME } and password: ${ !!process.env.SMTP_PASSWORD }}`);

		transporter.auth = {
			user: process.env.SMTP_USERNAME,
			pass: process.env.SMTP_PASSWORD
		};
	}

	// verify connection configuration
	transporter.verify((error, success) => {
		if (error) {
			log.error(error);
			process.exit(1);
		} else {
			console.log("Connected to SMTP server, will send emails");
		}
	});
}

// Make sure our temp directory exists
mkdirp(`${ config.tmpdir }`, (error) => {
	if (error)
		log.error(error);
});

function listCSVs(integrationConfig) {
	return new Promise((resolve, reject) => {
		let s3 = new AWS.S3({
			params: {
				Bucket: integrationConfig.placementsImporter.s3Bucket,
			}
		});

		s3.listObjectsV2({
			Prefix: `${ integrationConfig.placementsImporter.folderSource }/`
		}, (error, fileList) => {
			if (error)
				reject(error);
			else
				resolve(_.filter(fileList.Contents, (fileInfo) => {
					return _.endsWith(fileInfo.Key.toLowerCase(), ".csv");
				}));
		});
	});
}

function downloadCSV(integrationConfig, key) {
	return new Promise((resolve, reject) => {
		const localFile = `${ config.tmpdir }/${ uuid() }.csv`;

		let s3 = new AWS.S3({
			params: {
				Bucket: integrationConfig.placementsImporter.s3Bucket,
			}
		});

		var options = {
			Key: key,
		};

		var readStream = s3.getObject(options).createReadStream();
		var writeStream = fs.createWriteStream(localFile);

		readStream.on("error", error => reject(error));
		readStream.on("end", error => writeStream.end());
		writeStream.on("error", error => reject(error));
		writeStream.on("close", event => resolve(localFile));

		readStream.pipe(writeStream);
	});
}

function importCSV(path) {
	return new Promise((resolve, reject) => {
		let csv = [];

		fs.createReadStream(path, {
			encoding: "utf8"
		}).pipe(firstChunkStream({ chunkLength: 3 }, (err, chunk, enc, cb) => {
			// We need to strip off the byte order marker for utf8 files if it exists
			if (err) {
				cb(err);
				return;
			}

			if (!Buffer.isBuffer(chunk)) {
				throw new TypeError("Expected a Buffer, got " + typeof chunk);
			}

			if (chunk[0] === 0xEF && chunk[1] === 0xBB && chunk[2] === 0xBF && isUtf8(chunk)) {
				chunk = chunk.slice(3);
			}

			cb(null, chunk);
		})).pipe(csvparser())
			.on("data", (row) => csv.push(row))
			.on("error", (error) => reject(error))
			.on("end", () => resolve(csv));
	});
}

function deleteS3File(bucket, key) {
	return new Promise((resolve, reject) => {
		let s3 = new AWS.S3({
			params: {
				Bucket: bucket
			}
		});

		let params = {
			Delete: {
				Objects: [
					{
						Key: key
					}
				]
			}
		};

		s3.deleteObjects(params, (error, data) => {
			if (error)
				reject(error);
			else {
				log.info(`Deleted ${ key } in bucket ${ bucket }`);
				resolve();
			}
		});
	});
}

function renameS3File(bucket, fromKey, toKey) {
	return new Promise((resolve, reject) => {
		let s3 = new AWS.S3({
			params: {
				Bucket: bucket,
			}
		});

		let params = {
			Bucket: bucket,
			CopySource: `/${ bucket }/${ fromKey }`,
			Key: toKey
		};

		s3.copyObject(params, (error, data) => {
			if (error)
				reject(error);
			else
				log.info(`Copied ${ fromKey } to ${ toKey } in bucket ${ bucket }`);
				deleteS3File(bucket, fromKey).then((result) => {
					resolve(result);
				}, reject);
		});
	});
}

function writeS3File(bucket, data, toKey) {
	return new Promise((resolve, reject) => {
		let s3 = new AWS.S3();

		var readStream = new stream.Readable();
		readStream._read = () => {};
		readStream.push(data);
		readStream.push(null);

		let params = {
			Bucket: bucket,
			Key: toKey,
			Body: readStream
		}

		s3.upload(params, function(err, data) {
			if (err)
				reject(err);
			else
				resolve();
		});
	});
}

async function pollAndStoreUpdates(integrationConfig) {
	// Ensure we don't end up re-polling the same files if the previous session is ongoing
	if (integrationConfig.pollInProgress)
		return;
	
	integrationConfig.pollInProgress = true;

	const PLACEMENT_INSERT =`plac:ins:${ integrationConfig.legalEntityId }`;

	//log.info(`Polling placement insertions for ${ integrationConfig.name }`);

	// Poll S3 bucket for CSV files
	try {
		let csvFiles = await listCSVs(integrationConfig);

		if (!csvFiles.length) {
			integrationConfig.pollInProgress = false;
			return;
		}
	
		for (let u = 0; u < csvFiles.length; u++) {
			log.info(`Processing ${ csvFiles[u].Key }`);

			try {
				// Attempt to download and parse each CSV file
				var localFile = await downloadCSV(integrationConfig, csvFiles[u].Key);

				var csvObject = await importCSV(localFile);
			}
			catch (error) {
				// Couldn't process the CSV, move it to the bad place
				await renameS3File(integrationConfig.placementsImporter.s3Bucket, csvFiles[u].Key, `${ integrationConfig.placementsImporter.folderBad }/${ path.basename(csvFiles[u].Key) }`);
			}
			fs.unlink(localFile, () => {});
			
			// Combine rate lines with their respective placement lines
			let placements = {};
			let fieldMap = integrationConfig.placementsImporter.fieldMapping;
			let valueMap = integrationConfig.placementsImporter.valueMapping;

			csvObject.forEach((entry) => {
				let entityId = entry[fieldMap.placementId];

				switch(entry[fieldMap.rowType]) {
					case valueMap.placementRow:
						// Assign or update a placement
						if (!placements[entityId])
							placements[entityId] = _.pickBy(entry, _.identity);
						else
							_.assign(placements[entityId], _.pickBy(entry, _.identity));
						break;

					case valueMap.rateRow:
						// Create the placement if it doesn't exist
						if (!placements[entityId])
							placements[entityId] = {};
						
						// Create a rateLine property if it doesn't exist
						if (!placements[entityId].rateLines)
							placements[entityId].rateLines = {};
						
						placements[entityId].rateLines[entry[fieldMap.rateName]] = _.pickBy(entry, _.identity);
						break;
				}
			});

			// Process CSV file into dynamodb
			let badFile = false;

			_.forEach(placements, async (entry) => {
				for (let key in entry) {
					if (_.isString(entry[key]))
						entry[key] = entry[key].trim();
				}

				entry.sourceFile = csvFiles[u].Key;

				try {
					await datastore.upsertEntityUpdate(PLACEMENT_INSERT, entry[integrationConfig.placementsImporter.fieldMapping.placementId], entry);
				}
				catch(error) {
					log.error(error);
					badFile = true;
				}
			});
			
			// Move file into processed or rejected
			if (!badFile)
				await renameS3File(integrationConfig.placementsImporter.s3Bucket, csvFiles[u].Key, `${ integrationConfig.placementsImporter.folderGood }/${ path.basename(csvFiles[u].Key) }`);
			else {
				log.error(`Failed parsing ${ path.basename(csvFiles[u].Key) }`);
				await renameS3File(integrationConfig.placementsImporter.s3Bucket, csvFiles[u].Key, `${ integrationConfig.placementsImporter.folderBad }/${ path.basename(csvFiles[u].Key) }`);
			}
		}
	}
	catch(error) {
		log.error(error);
	}

	integrationConfig.pollInProgress = false;
}

async function processPlacement(integrationConfig, placement) {
	const PLACEMENT_INSERT =`plac:ins:${ integrationConfig.legalEntityId }`;
	let fieldMap = integrationConfig.placementsImporter.fieldMapping;
	let valueMap = integrationConfig.placementsImporter.valueMapping;

	try {
		// Create all of the things! Or just get them if like, you know, they exist

		// Create or get the worker
		let workerInfo = await workers.getOrCreateWorker(integrationConfig, placement.data);

		// Get the business, we don't create these because of the mess bad data would make
		let businessInfo = await businesses.getOrCreateBusiness(integrationConfig, placement.data);
		
		if (!businessInfo) {
			log.info(`Rejecting ${ placement.id } as Business is not registered or matching`);
			await datastore.failEntityUpdate(PLACEMENT_INSERT, placement, "Business is not registered or matching");
			return;
		}

		// Make a contact if required for the hiring manager
		let hiringContactInfo = await contacts.getOrCreateContacts(integrationConfig, placement.data, businessInfo.id);

		if (!hiringContactInfo) {
			log.info(`Rejecting ${ placement.id } as unable to register or match hiring manager`);
			await datastore.failEntityUpdate(PLACEMENT_INSERT, placement, "Hiring manager not found in Engage or cannot be created");
			return;
		}

		// Find the contact for the consultant manager
		let consultantContactInfo = await consultants.getConsultants(integrationConfig, placement.data);
		
		if (!consultantContactInfo || !consultantContactInfo.length) {
			log.info(`Rejecting ${ placement.id } as unable to register or match any consultants`);
			await datastore.failEntityUpdate(PLACEMENT_INSERT, placement, "Consultant not found in Engage or cannot be created");
			return;
		}

		// Make a site if required
		let siteInfo = await sites.getOrCreateSite(integrationConfig, placement.data, businessInfo.vendorManagerId);

		if (!siteInfo) {
			log.info(`Rejecting ${ placement.id } as unable to register or match site`);
			await datastore.failEntityUpdate(PLACEMENT_INSERT, placement, "Site not found in Engage or cannot be created");
			return;
		}

		// Make a position/trade if required
		let positionInfo = await positions.getOrCreatePosition(integrationConfig, placement.data, businessInfo.vendorManagerId);

		if (!positionInfo) {
			log.info(`Rejecting ${ placement.id } as unable to register position`);
			await datastore.failEntityUpdate(PLACEMENT_INSERT, placement, "Position/trade for worker not found in Engage or cannot be created");
			return;
		}

		// Create or update the placement
		await placements.createOrUpdatePlacement(integrationConfig, placement.data, businessInfo, consultantContactInfo, hiringContactInfo, workerInfo, positionInfo, siteInfo);
	}
	catch (error) {
		log.warn(error);

		// Something went wrong, lets make a copy of this failed entity
		await datastore.failEntityUpdate(PLACEMENT_INSERT, placement, _.get(error, "message", "Unknown reason"));
	}

	// Finished processing this entity, let's remove it
	await datastore.deleteEntityUpdate(PLACEMENT_INSERT, placement.id);
}

async function processUpdates(integrationConfig) {
	// Ensure we don't end up re-processing the queue asynchrounously if the previous session is ongoing
	if (integrationConfig.processInProgress)
		return;

		integrationConfig.processInProgress = true;

	const PLACEMENT_INSERT =`plac:ins:${ integrationConfig.legalEntityId }`;

	//log.info("Processing updates");

	let count = 0;
	do {
		var updates = await datastore.processEntityUpdates(PLACEMENT_INSERT, config.syncProcessCount);

		if (updates.length)
			log.info(`Retrieved ${ updates.length } placements from store`);

		for (let u = 0; u < updates.length; u++) {
			await processPlacement(integrationConfig, updates[u].Attributes);
			count += updates.length;
		}
	}
	while (updates.length);

	integrationConfig.processInProgress = false;

	if (count)
		log.info(`Processed ${ count } placements`);
}

function waitForTransporter() {
	return new Promise((resolve, reject) => {
		const waitForIt = () => {
			if (transporter)
				resolve();
			else
				setTimeout(waitForIt, 1000);
		};

		waitForIt();
	});		
}

async function sendAlerts(integrationConfig) {
	// Ensure we don't end up sending multiple alerts asynchrounously if the previous session is ongoing
	if (integrationConfig.processInProgress || integrationConfig.notifyInProgress)
		return;
	
	//log.info("Processing failed updates");

	integrationConfig.notifyInProgress = true;
	
	const PLACEMENT_INSERT =`plac:ins:${ integrationConfig.legalEntityId }`;

	// Pull all the entities
	let errorList = await datastore.processEntityUpdates(PLACEMENT_INSERT, config.syncProcessCount, true);

	if (errorList.length) {
		log.info(`Found ${ errorList.length } failed updates`);

		// Make a nice file
		let errorCSV = "Source File,Placement Id,Reason for Failure";

		errorList.forEach((row) => {
			errorCSV += `\r\n"${ row.Attributes.sourceFile }","${ row.Attributes.id }","${ row.Attributes.reason }"`;
		});

		// Stream the file to S3
		let errorFilename = `${ new Date().toISOString() }.csv`;
		await writeS3File(integrationConfig.placementsImporter.s3Bucket, errorCSV, `${ integrationConfig.placementsImporter.folderBad }/${ errorFilename }`);

		// Delete the bad entities
		await datastore.deleteBadEntities(PLACEMENT_INSERT, _.map(errorList, "Attributes.id"));

		if (sendEmails) {
			// Email file to someone who wants the list of errors
			let message = {
				from: {
					name: "Engage CSV Importer",
					address: "no_reply@engagetech.com"
				},
				to: {
					name: integrationConfig.errorEmail.name,
					address: integrationConfig.errorEmail.address
				},
				subject: `CSV import errors ${ errorFilename }`,
				text: `Hi ${ integrationConfig.errorEmail.name },

Whilst importing CSV files into the Engage platform, unfortunately some errors occured.

We have attached these issues to a new file and included it in this email.

To reprocess this file you will need to address the issues flagged and resubmit it.


The Team at Engage
`,
				attachments: [
					{
						filename: errorFilename,
						content: errorCSV
					}
				]
			};
			
			if (!transporter)
				await waitForTransporter();
			
			transporter.sendMail(message).then(() => {
				log.info(`${ errorFilename } sent to ${ integrationConfig.errorEmail.address }`);
			}).catch((error) => {
				log.error(error);
			});
		}
	}
	
	integrationConfig.notifyInProgress = false;
}

function createPlacementsPoller(integrationConfig) {
	return async () => {
		await healthCheck(integrationConfig);
		await pollAndStoreUpdates(integrationConfig);
		await processUpdates(integrationConfig);
		await sendAlerts(integrationConfig);
	};
}

async function healthCheck(integrationConfig) {
	const PLACEMENT_INSERT =`plac:ins:${ integrationConfig.legalEntityId }`;

	let activeUpdates = await datastore.getProcessingEntities(PLACEMENT_INSERT, config.syncProcessCount * 3);
	if (activeUpdates.length) {
		let newestDate = new Date(0);
		let oldestDate = new Date();
		let averageDate = 0;

		activeUpdates.forEach((entity) => {
			entity.processDate = new Date(entity.processDate);

			if (newestDate.getTime() < entity.processDate.getTime())
				newestDate = entity.processDate;

			if (oldestDate.getTime() > entity.processDate.getTime())
				oldestDate = entity.processDate;
			
			averageDate += entity.processDate.getTime();
		});

		averageDate = new Date(Math.abs(averageDate / activeUpdates.length));

		log.info(`${ integrationConfig.name } queue stats: len ${ activeUpdates.length }, old ${ ta.ago(oldestDate) }, new ${ ta.ago(newestDate) }, avg ${ ta.ago(averageDate) }`);
		let age = new Date().getTime() - oldestDate.getTime();

		integrationConfig.lastAlertTime = integrationConfig.lastAlertTime || new Date(new Date().getTime() - config.maxAlertTime);

		if (age > config.maxQueueTime) {
			integrationConfig.queueBackingUp = true;

			if (integrationConfig.lastAlertTime.getTime() < (new Date().getTime() - config.maxAlertTime)) {
				log.error(`${ integrationConfig.name } queue is backing up!`);
				integrationConfig.lastAlertTime = new Date();
			}
			else
				log.warn(`${ integrationConfig.name } queue is backing up!`);
		}
	}
	else if (integrationConfig.queueBackingUp) {
		integrationConfig.queueBackingUp = false;
		log.info(`${ integrationConfig.name } queue is ok!`);
	}
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;

		if (sendEmails)
			initialiseSMTP();
	},
	createPlacementsPoller: createPlacementsPoller
};
