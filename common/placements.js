"use strict";

const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const _ = require("lodash");
const mapper = require("../api/mapper");

var log = null;

function createOrUpdatePlacement(integrationConfig, placementInfo, businessInfo, consultantContactInfo, hiringContactInfo, workerInfo, positionInfo, siteInfo) {
	const engage = new Engage(integrationConfig);

	return new Promise(async (resolve, reject) => {
		let srcPlacement = mapper.placementToEngage(integrationConfig, placementInfo, businessInfo.vendorManagerId, workerInfo, positionInfo, siteInfo, consultantContactInfo, hiringContactInfo);
		let [ status, engPlacement ] = await engage.getPlacement(srcPlacement.externalId);

		if (status != 200)
			throw({ error: status, message: engPlacement.message });
		
		engPlacement = engPlacement._items.length ? engPlacement._items[0] : null;

		if (engPlacement) {
			log.info(`Placement ${ srcPlacement.externalId } already exists on Engage platform`);

			// Check if we need to update this placement
			srcPlacement.placementConsultants = srcPlacement.consultants;
			delete srcPlacement.consultants;
			srcPlacement.newFinishDate = `${ srcPlacement.finishDate }T00:00:00.000Z`;
			srcPlacement.newStartDate = `${ srcPlacement.startDate }T00:00:00.000Z`;
			let [ status, newPlacement ] = await engage.updatePlacement(srcPlacement, engPlacement.id);

			if ((status != 200) && (status != 204)) {
				reject({ error: status, message: _.get(newPlacement, "message", _.isArray(newPlacement.errors) ? newPlacement.errors.join(", ") : JSON.stringify(newPlacement)) });
				return;
			}

			log.info(`Updated placement ${ srcPlacement.externalId }`);

			return resolve(engPlacement);
		}
		else {
			try {
				let [ status, newPlacement ] = await engage.createPlacement(srcPlacement);

				if ((status != 201) && (status != 204)) {
					reject({ error: status, message: _.get(newPlacement, "message", _.isArray(newPlacement.errors) ? newPlacement.errors.join(", ") : JSON.stringify(newPlacement)) });
					return;
				}
				
				log.info(`Created new placement for ${ srcPlacement.externalId }`);

				resolve(newPlacement);
			}
			catch (error) {
				log.info(`An error occurred (HTTP ${ error.message }) while creating placement ${ placementInfo.id }`);
				reject(error);
			}
		}
	});
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	createOrUpdatePlacement: createOrUpdatePlacement
};
