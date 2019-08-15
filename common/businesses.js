"use strict";

const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const mapper = require("../api/mapper");
const _ = require("lodash");

let log = null;

let businessStore = {};
let vendorManagerStore = {};
let cacheAge = {};
let maxAge = 5 * 60 * 1000;

async function updateVendorManagers(integrationConfig, hirerId) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;
	const mapping = integrationConfig.placementsImporter.fieldMapping;

	let [ status, body ] = await engage.getVendorManagers();

	if (status === 200)
		vendorManagerStore[integrName] = body;
	else
		log.error(`Error loading vendor managers ${ status } - ${ JSON.stringify(body) }`);
}

function businessNameToKey(businessName) {
	return businessName.toLowerCase()
		.trim()
		.replace(/(limited|ltd)[\.;:]?$/, "")
		.replace(/^a-zA-Z\d\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

async function getOrCreateBusiness(integrationConfig, business) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;
	const mapping = integrationConfig.placementsImporter.fieldMapping;

	businessStore[integrName] = businessStore[integrName] || {};
	cacheAge[integrName] = cacheAge[integrName] || new Date(0);

	// We will maintain a cache of businesses to speed things up
	if ((new Date() - cacheAge[integrName]) > maxAge) {
		log.info(`Business cache for ${ integrName } out of date, updating`);

		await updateVendorManagers(integrationConfig, 0);

		let [ status, body ] = await engage.getBusinesses();
		cacheAge[integrName] = new Date();
		
		if (status === 200) {
			_.assign(businessStore[integrName], _.keyBy(body._items, (business) => businessNameToKey(business.legalName)));

			// Clear out any empty businesses (originally this removed ones without company numbers)
			businessStore[integrName] = _.pickBy(businessStore[integrName], _.identity);
		}
		else
			throw({ error: status, message: `Error loading businesses - ${ JSON.stringify(body) }` });
	}

	let srcBusiness = businessNameToKey(business[mapping.legalName]);
	let engBusiness = businessStore[integrName][srcBusiness];

	// No business found, let's see if we can match one with a company number
	if (!engBusiness && _.isString(business[mapping.companyNumber])) {
		var companyNumber = business[mapping.companyNumber];

		if (!companyNumber.trim().match(/^[a-z]/i))
			companyNumber = _.padStart(parseInt(companyNumber, 10), 8, "0");
		
		engBusiness = _.find(businessStore[integrName], (value) => {
			if (!_.isString(value.companyNumber))
				return false;

			return value.companyNumber.trim() == companyNumber;
		});
	}

	// No business found, let's create one if we have a company number
	if (!engBusiness) {
		let newBusiness = mapper.businessToEngage(integrationConfig, business);
		let [ status, createdBusiness ] = await engage.createBusiness(newBusiness);

		if ((status != 200) && (status != 204))
			throw({ error: status, message: createdBusiness.message });
		
		// Now we need to set the accountref if it exists
		let accountReference = business[integrationConfig.placementsImporter.fieldMapping.accountReference];

		if (accountReference) {
			let newReference = {
				legalEntityId: createdBusiness.id,
				accountReference: accountReference
			};

			let [ status, result ] = await engage.setBusinessReference(newReference);

			if ((status != 200) && (status != 204))
				log.info({ error: status, message: result });
		}
		await updateVendorManagers(integrationConfig, 0);
		
		// Add to our cache
		engBusiness = createdBusiness;
		businessStore[integrName][businessNameToKey(engBusiness.legalName)] = createdBusiness;

		log.info(`Created business ${ srcBusiness } on Engage`);
	}
	else
		log.info(`Found business ${ srcBusiness } on Engage`);

	if (engBusiness) {
		// look for a vendor manager id
		let vendor = _.find(vendorManagerStore[integrName], (vendorManager) => (vendorManager.hirerLegalEntityId == engBusiness.id));

		if (vendor)
			engBusiness.vendorManagerId = vendor.id
		else
			throw({ error: 404, message: `Unable to find vendorManager for ${ srcBusiness }` });
	}

	return engBusiness;
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	getOrCreateBusiness: getOrCreateBusiness
};
