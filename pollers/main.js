"use strict";

/******************************************************************************************

Triggers cron jobs that poll endpoints

******************************************************************************************/

const importer = require("./importer.js");

module.exports = {
	register: (integrationConfig) => {
		importer.addPollers(integrationConfig);
	}
};
