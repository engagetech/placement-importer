"use strict";

const _ = require("lodash");

/******************************
 * Mapping utilities for data between bullhorn and engage
 ******************************/

function _mapNested(mapping, seed, prefix, data) {
	return _.reduce(data, (result, value, key) => {
		const mappedKey = mapping[prefix + "." + key];
		if (mappedKey) 
			_.set(result, mappedKey, value);
		
		return result;
	}, seed);
}

function _mapWithMapping(mapping, data) {
	return _.reduce(data, (result, value, key) => {
		if (_.isObject(value))
			return _mapNested(mapping, result, key, value);
		else {
			const mappedKey = mapping[key];
			if (mappedKey) 
				_.set(result, mappedKey, value);
			
			return result;
		}
	}, {});
}

function engageToWorker(integrationConfig, data) {
	const mapping = integrationConfig.placementsImporter.mappings.toEngageWorker;
	const mapped = _mapWithMapping(mapping, data);

	return mapped;
}

function workerToEngage(integrationConfig, data) {
	const mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageWorker);
	const mapped = _mapWithMapping(mapping, data);
	
	if (mapped.documentsTags)
		mapped.documentsTags = _.map(mapped.documentsTags.split(","), (s) => s.trim());

	return mapped;
}

function contactToEngage(integrationConfig, type, data, legalEntityId) {
	switch (type) {
		case "hiring":
			var mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageHiringContact);
			break;

		case "consultant":
			mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageConsultantContact);
			break;
		
		case "consultant2":
			mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageConsultant2Contact);
			break;
		
		case "consultant3":
			mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageConsultant3Contact);
			break;
	}
			
	const mapped = _mapWithMapping(mapping, data);
	mapped.legalEntityId = legalEntityId;
	
	return mapped;
}

function rateToEngage(integrationConfig, data) {
	const mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageRate);
	const mapped = _mapWithMapping(mapping, data);
	
	return mapped;
}

function positionToEngage(integrationConfig, data, vendorManagerId) {
	const mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngagePosition);
	const mapped = _mapWithMapping(mapping, data);

	mapped.rates = [];

	_.each(data.rateLines, (value, key) => {
		let rate = rateToEngage(integrationConfig, value);

		rate.name = key;
		//rate.startDate = mapped.startDate;
		//rate.finishDate = mapped.finishDate;
		rate.primary = (value[integrationConfig.placementsImporter.fieldMapping.rateName] == data[integrationConfig.placementsImporter.fieldMapping.defaultRate]);
		switch (data[integrationConfig.placementsImporter.fieldMapping.payType]) {
			case "PAYE":
				rate.payType = "PAYE";
				break;
				
			default:
				rate.payType = "CONTRACT";
		}

		mapped.rates.push(rate);
	});

	// Defaults not imported but required
	mapped.vendorManagerId = vendorManagerId;
	mapped.placementPositionFollowers = [];
	mapped.defaultJobDescription = "";
	mapped.defaultQualifications = "";
	mapped.approvalMode = "AUTOMATIC";
	
	return mapped;
}

function siteToEngage(integrationConfig, data, vendorManagerId) {
	const mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageSite);
	const mapped = _mapWithMapping(mapping, data);

	// Defaults not imported but required
	mapped.vendorManagerId = vendorManagerId;
	mapped.startTime = 480;
	mapped.finishTime = 1080;
	mapped.inductionTime = 465;
	mapped.unpaidBreak = 0;
	mapped.openingDays = [ 1, 2, 3, 4, 5, 6, 7 ];
	
	return mapped;
}

function placementToEngage(integrationConfig, data, vendorManagerId, workerInfo, positionInfo, siteInfo, consultantContactInfo, hiringContactInfo) {
	const mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngagePlacement);
	const mapped = _mapWithMapping(mapping, data);
	
	// Values pulled from Engage
	mapped.personId = workerInfo.id;
	mapped.tradeId = positionInfo.id;
	mapped.siteId = siteInfo.id;
	mapped.placementManagerId = hiringContactInfo.id;

	// There may be multiple consultants here
	mapped.consultants = _.map(consultantContactInfo, (consultant) => {
		return {
			personId: consultant.personId,
			commission: consultant.commission || (100 / consultantContactInfo.length)
		};
	});

	mapped.rates = [];

	_.each(data.rateLines, (value, key) => {
		let rate = rateToEngage(integrationConfig, value);

		rate.name = key;
		rate.startDate = mapped.startDate;
		rate.finishDate = mapped.finishDate;
		rate.primary = (value[integrationConfig.placementsImporter.fieldMapping.rateName] == data[integrationConfig.placementsImporter.fieldMapping.defaultRate]);
		switch (data[integrationConfig.placementsImporter.fieldMapping.payType]) {
			case "PAYE":
				rate.payType = "PAYE";
				break;

			default:
				rate.payType = "CONTRACT";
		}

		mapped.rates.push(rate);
	});

	// Defaults not imported but required
	mapped.vendorManagerId = vendorManagerId;
	mapped.timesheetDuration = "WEEK";
	mapped.placementType = mapped.placementType || "TEMPORARY";
	mapped.startTime = 480;
	mapped.finishTime = 1080;
	mapped.openingDays = [ 1, 2, 3, 4, 5, 6, 7 ];
	mapped.timesheetApprover = {
		id: hiringContactInfo.id,
		personId: hiringContactInfo.personId
	};

	mapped.timesheetPeriodStart = mapped.timesheetPeriodStart || new Date(integrationConfig.defaultTimesheetPeriodStart);
	
	return mapped;
}

function businessToEngage(integrationConfig, data)
{
	const mapping = _.invert(integrationConfig.placementsImporter.mappings.toEngageBusiness);
	const mapped = _mapWithMapping(mapping, data);

	return mapped;
}

module.exports = {
	workerToEngage: workerToEngage,
	engageToWorker: engageToWorker,
	contactToEngage: contactToEngage,
	placementToEngage: placementToEngage,
	rateToEngage: rateToEngage,
	siteToEngage: siteToEngage,
	positionToEngage: positionToEngage,
	businessToEngage: businessToEngage
};
