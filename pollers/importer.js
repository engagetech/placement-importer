"use strict";

/******************************************************************************************

Routes for bullhorn polling

******************************************************************************************/

const cron = require("node-cron");
const _ = require("lodash");

const datastore = require("../datastore/main").createOrGet();

const workers = require("../common/workers");
const businesses = require("../common/businesses");
const contacts = require("../common/contacts");
const consultants = require("../common/consultants");
const sites = require("../common/sites.js");
const positions = require("../common/positions.js");
const placements = require("../common/placements");
const pollerPlacements = require("./placements");

var log = null;

module.exports = {
	addPollers: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;

		workers.configure(integrationConfig);
		businesses.configure(integrationConfig);
		contacts.configure(integrationConfig);
		consultants.configure(integrationConfig);
		placements.configure(integrationConfig);
		sites.configure(integrationConfig);
		positions.configure(integrationConfig);

		pollerPlacements.configure(integrationConfig);

		datastore.getAllIntegrations().then((integrations) => {
			integrations.forEach((integration) => {
				log.info(`Scheduling integration with id ${ integration.id } (${ integration.name }), schedule ${ integration.placementsImporter.cronSchedule }`);
				cron.schedule(integration.placementsImporter.cronSchedule || integration.bullhorn.cronSchedule, pollerPlacements.createPlacementsPoller(integration));
			});
		});
	}
};
