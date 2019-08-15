"use strict";

const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const mapper = require("../api/mapper");
const _ = require("lodash");

var log = null;

let providerProvisionStore = {};
let cacheAge = {};
let maxAge = 5 * 60 * 1000;

async function getProviderProvisions(integrationConfig) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;

	providerProvisionStore[integrName] = providerProvisionStore[integrName] || {};
	cacheAge[integrName] = cacheAge[integrName] || new Date(0);

	// We will maintain a cache of consultants to speed things up
	if ((new Date() - cacheAge[integrName]) > maxAge) {
		log.info(`Provider provision cache for ${ integrName } out of date, updating`);

		let [ status, body ] = await engage.getProviderProvisions();
		cacheAge[integrName] = new Date();
		
		if (status === 200) {
			providerProvisionStore[integrName] = _.filter(body._items, (provision) => provision.type != "PAYE");
			integrationConfig.payeWeeklyId = _.get(_.find(body._items, (provision) => provision.label == "PAYE (Weekly)"), "id", null);
			integrationConfig.payeMonthlyId = _.get(_.find(body._items, (provision) => provision.label == "PAYE (Monthly)"), "id", null);
		}
		else
			throw ({ error: status, message: `Unable to read providers from Engage: ${ JSON.stringify(body) }` });
	}
}

async function createWorker(integrationConfig, worker) {
	const engage = new Engage(integrationConfig);

	let [ status, response ] = await engage.createWorker(worker);
	
	if (status === 200) {
		log.info(`Engage worker ${ response.employeeId } created`);
		const id = response.employeeId;
		const payload = {
			action: "notification",
			type: "registration",
			data: {
				"email": true,
				"sms": true
			}
		};
		log.info(`Triggering registration notification for ${ response.employeeId }`);
		await engage.triggerAction(response.employeeId, payload);

		return [ status, response ];
	}
	else {
		log.warn(`Cannot register worker, http ${ status }, message: ${ JSON.stringify(response) }`);
		return Promise.reject({ error: status, message: _.get(response, "error.message", JSON.stringify(response)) });
	}
}

function getOrCreateWorker(integrationConfig, workerInfo) {
	const engage = new Engage(integrationConfig);

	return new Promise(async (resolve, reject) => {

		try {
			await getProviderProvisions(integrationConfig);
		}
		catch (error) {
			log.error("Unable to retrieve provider provisions");
			reject(error);
			return;
		}

		let worker = mapper.workerToEngage(integrationConfig, workerInfo);
		let [ status, engWorker ] = await engage.getWorker(worker.employeeId);

		if (status === 200) {
			log.info(`Worker ${ worker.employeeId } already exists on Engage platform`);
			return resolve(engWorker);
		}
		else if (status === 404) {
			try {
				// Set the worker's pay type
				switch (workerInfo[integrationConfig.placementsImporter.fieldMapping.payType]) {
					case "PAYE":
						worker.providerId = integrationConfig.payeWeeklyId;
						worker.paymentTypeId = 1;
						break;
					case "LTD":
						worker.providerId = null;
						worker.paymentTypeId = 3;
						break;
				}
				
				let [ status, newWorker ] = await createWorker(integrationConfig, worker);

				if ((status != 200) && (status != 204))
					throw({ error: status, message: error.message });

				resolve(newWorker);
			}
			catch (error) {
				log.info(`An error occurred (HTTP ${ status } - ${ _.get(error.message, error) }) while creating worker ${ worker.employeeId }`);
				reject(error);
			}
		}
		else {
			log.info(`An error occurred (HTTP ${ status }) while fetching worker ${ worker.employeeId }`);
			reject(_.get(status, "message", status));
		}
	});
}


module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	getOrCreateWorker: getOrCreateWorker 
};
