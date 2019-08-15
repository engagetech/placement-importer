"use strict";

const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const _ = require("lodash");
const mapper = require("../api/mapper");

var log = null;

let contactsStore = {};
let cacheAge = {};
let maxAge = 5 * 60 * 1000;

async function getContact(integrationConfig, contact) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;
	const mapping = integrationConfig.placementsImporter.fieldMapping;

	contactsStore[integrName] = contactsStore[integrName] || {};
	cacheAge[integrName] = cacheAge[integrName] || new Date(0);

	// We will maintain a cache of contacts to speed things up
	if ((new Date() - cacheAge[integrName]) > maxAge) {
		log.info(`Contacts cache for ${ integrName } out of date, updating`);

		let [ status, body ] = await engage.getContacts();
		cacheAge[integrName] = new Date();
		
		if (status === 200) {
			_.assign(contactsStore[integrName], _.keyBy(body, (contact) => {
				return _.isString(contact.personDetail.email) ? contact.personDetail.email.toLowerCase().trim() : "";
			}));

			// Clear out any empty contacts
			contactsStore[integrName] = _.pickBy(contactsStore[integrName], _.identity);
		}
		else
			throw({ error: status, message: `Unable to read contacts from Engage: ${ body }` });
	}

	let engContact = contactsStore[integrName][String(contact.personDetail.email).toLowerCase().trim()];

	if (engContact)
		log.info(`Found contact ${ contact.personDetail.firstName } ${ contact.personDetail.surname } on Engage`);

	return engContact;
}

function getOrCreateContacts(integrationConfig, contactInfo, legalEntityId) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;

	return new Promise(async (resolve, reject) => {
		let srcHiringContact = mapper.contactToEngage(integrationConfig, "hiring", contactInfo, legalEntityId);
		let engHiringContact = await getContact(integrationConfig, srcHiringContact);

		if (engHiringContact) {
			log.info(`Hiring contact ${ engHiringContact.personDetail.firstName } already exists on Engage platform`);
			return resolve(engHiringContact);
		}
		else {
			try {
				let [ status, newContact ] = await engage.createContact(srcHiringContact);

				if ((status != 200) && (status != 204))
					throw({ error: status, message: newContact.message });
				
				// Add to our cache
				let contactName = `${ newContact.personDetail.firstName } ${ newContact.personDetail.surname }`.trim();
				contactsStore[integrName][newContact.personDetail.email.toLowerCase().trim()] = newContact;

				log.info(`Created new contact ${ contactName }`);

				resolve(newContact);
			}
			catch (error) {
				log.info(`An error occurred (HTTP ${ error.message }) while creating contact ${ srcHiringContact.personDetail.firstName }`);
				reject(error);
			}
		}
	});
}


module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	getOrCreateContacts: getOrCreateContacts 
};
