"use strict";

const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const _ = require("lodash");
const mapper = require("../api/mapper");

var log = null;

let consultantsStore = {};
let cacheAge = {};
let maxAge = 5 * 60 * 1000;

async function getConsultants(integrationConfig, contact) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;
	const mapping = integrationConfig.placementsImporter.fieldMapping;
	
	let contacts = [
		mapper.contactToEngage(integrationConfig, "consultant", contact, integrationConfig.legalEntityId),
		mapper.contactToEngage(integrationConfig, "consultant2", contact, integrationConfig.legalEntityId),
		mapper.contactToEngage(integrationConfig, "consultant3", contact, integrationConfig.legalEntityId)
	];

	// Clear out any empty consultants
	contacts = _.filter(contacts, value => value.personDetail);

	consultantsStore[integrName] = consultantsStore[integrName] || {};
	cacheAge[integrName] = cacheAge[integrName] || new Date(0);

	// We will maintain a cache of consultants to speed things up
	if ((new Date() - cacheAge[integrName]) > maxAge) {
		log.info(`Consultants cache for ${ integrName } out of date, updating`);

		let [ status, body ] = await engage.getConsultants();
		cacheAge[integrName] = new Date();
		
		if (status === 200) {
			// Remove anything without an email address
			body = _.filter(body, "email");
			
			// Create a map of email addresses to contacts
			_.assign(consultantsStore[integrName], _.keyBy(body, (contact) => contact.email.trim().toLowerCase()));

			// Clear out any empty consultants
			consultantsStore[integrName] = _.pickBy(consultantsStore[integrName], _.identity);
		}
		else
			throw({ error: status, message: `Unable to read consultants from Engage: ${ body }` });
	}

	let engContacts = [];

	contacts.forEach((value) => {
		let srcContact = value.personDetail.email.trim().toLowerCase();
		let engContact = consultantsStore[integrName][srcContact];

		if (engContact) {
			log.info(`Found consultant ${ srcContact } on Engage`);
			engContact.commission = value.commission;
			engContacts.push(engContact);
		}
	});

	// Either all consultants match or none do
	return (contacts.length == engContacts.length) ? engContacts : null;
}


module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	getConsultants: getConsultants
};
