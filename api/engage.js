"use strict";

const Promise = require("bluebird");
const request = Promise.promisifyAll(require("request"), { multiArgs: true });
const _ = require("lodash");

class Engage {
	constructor({ engageExternalApi, engageApiKey }) {
		this.engageExternalApi = engageExternalApi;
		this.engageApiKey = engageApiKey;
	}

	_getAuthHeader() {
		return {
			"x-api-key": this.engageApiKey
		};
	}

	createWorker(worker) {
		const options = {
			url: `${ this.engageExternalApi }/workers`,
			headers: this._getAuthHeader(),
			json: true,
			body: worker
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getWorker(id) {
		const options = {
			url: `${ this.engageExternalApi }/workers/${ id }`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getProviderProvisions() {
		const options = {
			url: `${ this.engageExternalApi }/providers`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	};

	triggerAction(id, data) {
		const options = {
			url: `${ this.engageExternalApi }/workers/${ id }/actions`,
			headers: this._getAuthHeader(),
			json: true,
			body: data
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getBusinesses() {
		const options = {
			url: `${ this.engageExternalApi }/businesses?limit=9000`,
			headers: this._getAuthHeader(),
			json: true
		};
		
		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	createBusiness(business) {
		const options = {
			url: `${ this.engageExternalApi }/businesses`,
			headers: this._getAuthHeader(),
			json: true,
			body: business
		};
		
		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	setBusinessReference(reference) {
		const options = {
			url: `${ this.engageExternalApi }/relationships`,
			headers: this._getAuthHeader(),
			json: true,
			body: reference
		};
		
		return request.putAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getContacts() {
		const options = {
			url: `${ this.engageExternalApi }/contacts?limit=90000&owncontacts=false`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getConsultants() {
		const options = {
			url: `${ this.engageExternalApi }/contactusers?placementrole=consultant&pageSize=9999&query=`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	createContact(contact) {
		const options = {
			url: `${ this.engageExternalApi }/contacts`,
			headers: this._getAuthHeader(),
			json: true,
			body: contact
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getSites() {
		const options = {
			url: `${ this.engageExternalApi }/sites?pageSize=9000`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	createSite(site) {
		const options = {
			url: `${ this.engageExternalApi }/sites`,
			headers: this._getAuthHeader(),
			json: true,
			body: site
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getPositions() {
		const options = {
			url: `${ this.engageExternalApi }/positions?pageSize=9000`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	createPosition(position) {
		const options = {
			url: `${ this.engageExternalApi }/positions`,
			headers: this._getAuthHeader(),
			json: true,
			body: position
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getPlacement(id) {
		const options = {
			url: `${ this.engageExternalApi }/placements?externalids=${ String(id).toLowerCase() }`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	createPlacement(placement) {
		const options = {
			url: `${ this.engageExternalApi }/placements`,
			headers: this._getAuthHeader(),
			json: true,
			body: placement
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	updatePlacement(placement, id) {
		const options = {
			url: `${ this.engageExternalApi }/placements/${ id }/amendment/EXTENDED`,
			headers: this._getAuthHeader(),
			json: true,
			body: placement
		};

		return request.postAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}

	getVendorManagers() {
		const options = {
			url: `${ this.engageExternalApi }/vendormanagers`,
			headers: this._getAuthHeader(),
			json: true
		};

		return request.getAsync(options)
			.then(([res, body]) => {
				return [res.statusCode, body];
			});
	}
}

module.exports = {
	Engage: Engage
};
