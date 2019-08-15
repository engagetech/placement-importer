"use strict";

const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const _ = require("lodash");
const mapper = require("../api/mapper");

var log = null;

let sitesStore = {};
let cacheAge = {};
let maxAge = 5 * 60 * 1000;

async function getSite(integrationConfig, site) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;
	const mapping = integrationConfig.placementsImporter.fieldMapping;

	sitesStore[integrName] = sitesStore[integrName] || {};
	cacheAge[integrName] = cacheAge[integrName] || new Date(0);

	// We will maintain a cache of sites to speed things up
	if ((new Date() - cacheAge[integrName]) > maxAge) {
		log.info(`Sites cache for ${ integrName } out of date, updating`);

		let [ status, body ] = await engage.getSites();

		cacheAge[integrName] = new Date();
		
		if (status === 200) {
			let sites = body._items;

			_.assign(sitesStore[integrName], _.keyBy(sites, (site) => site.name));

			// Clear out any empty sites
			sitesStore[integrName] = _.pickBy(sitesStore[integrName], _.identity);
		}
		else
			throw({ error: status, message: `Unable to read sites from Engage: ${ body }` });
	}

	let engSite = sitesStore[integrName][site.name.trim()];

	if (engSite)
		log.info(`Found site ${ site.name } on Engage`);

	return engSite;
}

function getOrCreateSite(integrationConfig, siteInfo, legalEntityId) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;

	return new Promise(async (resolve, reject) => {
		let srcSite = mapper.siteToEngage(integrationConfig, siteInfo, legalEntityId);
		let engSite = await getSite(integrationConfig, srcSite);
		
		if (engSite) {
			log.info(`Site ${ engSite.name } already exists on Engage platform`);
			return resolve(engSite);
		}
		else {
			try {
				let [ status, newSite ] = await engage.createSite(srcSite);

				if ((status != 201) && (status != 204))
					throw({ error: status, message: _.isArray(newSite.errors) ? newSite.errors.join(", ") : _.get(newSite, "newSite.message", newSite) });
				
				// Add to our cache
				sitesStore[integrName][srcSite.name.trim()] = newSite;

				log.info(`Created new site ${ srcSite.name }`);

				resolve(newSite);
			}
			catch (error) {
				log.info(error);
				log.info(`An error occurred (HTTP ${ error.message }) while creating site ${ srcSite.name }`);
				reject(error);
			}
		}
	});
}


module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	getOrCreateSite: getOrCreateSite 
};
