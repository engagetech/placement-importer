"use strict";

const { Engage } = require("../api/engage");
const Promise = require("bluebird");
const _ = require("lodash");
const mapper = require("../api/mapper");

var log = null;

let positionsStore = {};
let cacheAge = {};
let maxAge = 5 * 60 * 1000;

async function getPosition(integrationConfig, position, vendorManagerId) {const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;
	const mapping = integrationConfig.placementsImporter.fieldMapping;

	positionsStore[integrName] = positionsStore[integrName] || {};
	cacheAge[integrName] = cacheAge[integrName] || new Date(0);
	
	// We will maintain a cache of positions to speed things up
	if ((new Date() - cacheAge[integrName]) > maxAge) {
		log.info(`Positions cache for ${ integrName } out of date, updating`);

		let [ status, body ] = await engage.getPositions();
		cacheAge[integrName] = new Date();
		
		if (status === 200) {
			let positions = body._items;

			_.assign(positionsStore[integrName], _.keyBy(positions, (position) => `${ position.vendorManager.id }-${ position.name.toLowerCase().trim() }`));

			// Clear out any empty positions
			positionsStore[integrName] = _.pickBy(positionsStore[integrName], _.identity);
		}
		else
			throw({ error: status, message: `Unable to read positions from Engage: ${ body }` });
	}

	let engPosition = positionsStore[integrName][`${ vendorManagerId }-${ position.name.toLowerCase().trim() }`];

	if (engPosition)
		log.info(`Found position ${ position.name } on Engage`);

	return engPosition;
}

function getOrCreatePosition(integrationConfig, positionInfo, vendorManagerId) {
	const engage = new Engage(integrationConfig);
	const integrName = integrationConfig.name;

	return new Promise(async (resolve, reject) => {
		let srcPosition = mapper.positionToEngage(integrationConfig, positionInfo, vendorManagerId);
		let engPosition = await getPosition(integrationConfig, srcPosition, vendorManagerId);

		if (engPosition) {
			log.info(`Position ${ engPosition.name } already exists on Engage platform`);
			return resolve(engPosition);
		}
		else {
			try {
				let [ status, newPosition ] = await engage.createPosition(srcPosition);

				if ((status != 201) && (status != 204))
					throw({ error: status, message: newPosition.message });

				srcPosition.id = newPosition.id;
				
				// Add to our cache
				positionsStore[integrName][`${ vendorManagerId }-${ srcPosition.name.toLowerCase().trim() }`] = srcPosition;

				log.info(`Created new position ${ srcPosition.name }`);

				resolve(srcPosition);
			}
			catch (error) {
				log.info(error);
				log.info(`An error occurred (HTTP ${ _.get(error, "error.message", error) }) while creating position ${ srcPosition.name }`);
				reject(error);
			}
		}
	});
}

module.exports = {
	configure: (integrationConfig) => {
		log = integrationConfig.getLogUtils().log;
	},
	getOrCreatePosition: getOrCreatePosition
};
