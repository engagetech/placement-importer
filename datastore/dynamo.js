"use strict";

const AWS = require("aws-sdk");
const Promise = require("bluebird");

class DynamoDataStore {

	constructor(config) {
		let awsConfig = new AWS.Config();
		awsConfig.setPromisesDependency(Promise);
		awsConfig.update(config);

		this.dynamodb = new AWS.DynamoDB(awsConfig);
		this.docClient = new AWS.DynamoDB.DocumentClient(awsConfig);
	}

	/**
	 * Adds a record indicating this entity will have to be processed
	 * @param {String} entity candidate etc.
	 * @param {number} id the id of the
	 * @param {Object} data additional information to store
	 * @returns {Promise} Nothing should be expected as a return
	 */
	upsertEntityUpdate(entity, id, data = {}) {
		const params = {
			TableName: "PlaceImp-EntityUpdates",
			Item: {
				entity: entity,
				id: id,
				processing: 0,
				data: data
			}
		};

		return this.docClient.put(params).promise();
	}

	/**
	 * Removes a record that has been processed
	 * @param {String} entity candidate etc.
	 * @param {number} id the id of the
	 * @returns {Promise} Nothing should be expected as a return
	 */
	deleteEntityUpdate(entity, id, badEntities) {
		const params = {
			TableName: badEntities ? "PlaceImp-FailedEntityUpdates" : "PlaceImp-EntityUpdates",
			Key: {
				"entity": entity,
				"id": id
			}
		};
		return this.docClient.delete(params).promise();
	}

	/**
	 * Copies a record that failed processing to the failed entity area
	 * @param {String} entity candidate etc.
	 * @param {number} item the data of this entity
	 * @returns {Promise} Nothing should be expected as a return
	 */
	async failEntityUpdate(entity, item, reason) {
		let params = {
			TableName: "PlaceImp-EntityUpdates",
			Key: {
				"entity": entity,
				"id": item.id
			}
		};

		const failedEntity = await this.docClient.get(params).promise();

		params = {
			TableName: "PlaceImp-FailedEntityUpdates",
			Item: {
				entity: entity,
				id: item.id,
				processing: 0,
				data: failedEntity.data,
				reason: reason,
				sourceFile: item.data.sourceFile
			}
		};

		await this.docClient.put(params).promise();
		await this.deleteEntityUpdate(entity, item.id);
	}

	/**
	 * All records that have to be processed for the given entity.
	 * Datastore will provide the following data [ { entity: 'candidate', id: 72 } ]
	 * @param {string} entity The entity to query updates for e.g. candidate 
	 * @returns {Promise} A promise of all the updates for the given entity
	 */
	findEntityUpdates(entity, limit, badEntities) {
		return new Promise(async (resolve, reject) => {
			// Because we are filtering results after retrieving them, we may need multiple scans
			// before we get actual results
			let entityUpdates = [];
			let scannedCount = 0;

			const params = {
				TableName: badEntities ? "PlaceImp-FailedEntityUpdates" : "PlaceImp-EntityUpdates",
				KeyConditionExpression: "entity = :entity",
				FilterExpression: "processing = :falsevalue",
				ExpressionAttributeValues: {
					":entity": entity,
					":falsevalue": 0
				},
				ExclusiveStartKey: null,
				Limit: limit
			};

			do {
				var results = await this.docClient.query(params).promise();
				entityUpdates = entityUpdates.concat(results.Items);

				// This is how we do paging!
				params.ExclusiveStartKey = results.LastEvaluatedKey;
				scannedCount += results.ScannedCount;
			}
			while ((entityUpdates.length < limit) && results.ScannedCount && results.LastEvaluatedKey);
			
			resolve(entityUpdates);
		});
	}

	/**
	 * Return a set of records that have to be processed for the given entity,
	 * and mark those records as in progress
	 * Datastore will provide the following data [ { entity: 'candidate', id: 72 } ]
	 * @param {string} entity The entity to query updates for e.g. candidate 
	 * @returns {Promise} A promise of all the updates for the given entity
	 */
	processEntityUpdates(entity, limit, badEntities) {
		return new Promise((resolve, reject) => {
			this.findEntityUpdates(entity, limit, badEntities).then(async (results) => {
				let processList = [];

				for (let u = 0; u < results.length; u++) {
					const params = {
						TableName: badEntities ? "PlaceImp-FailedEntityUpdates" : "PlaceImp-EntityUpdates",
						Key: {
							entity: entity,
							id: results[u].id
						},
						UpdateExpression: "SET processing = :truevalue, processDate = :now",
						ConditionExpression: "processing = :falsevalue",
						ExpressionAttributeValues: {
							":truevalue": 1,
							":falsevalue": 0,
							":now": new Date().toISOString()
						},
						ReturnValues: "ALL_NEW"
					};

					processList.push(await this.docClient.update(params).promise());
				};

				resolve(processList);
			});
		});
	}

	/**
	 * Return a set of records marked as being actively processed for the given entity,
	 * Datastore will provide the following data [ { entity: 'candidate', id: 72 } ]
	 * @param {string} entity The entity to query updates for e.g. candidate 
	 * @returns {Promise} A promise of all the updates for the given entity
	 */
	getProcessingEntities(entity, limit) {
		return new Promise(async (resolve, reject) => {
			// Because we are filtering results after retrieving them, we may need multiple scans
			// before we get actual results
			let entityUpdates = [];
			let scannedCount = 0;

			const params = {
				TableName: "PlaceImp-EntityUpdates",
				KeyConditionExpression: "entity = :entity",
				FilterExpression: "processing = :truevalue",
				ExpressionAttributeValues: {
					":entity": entity,
					":truevalue": 1
				},
				ExclusiveStartKey: null,
				Limit: limit
			};

			do {
				var results = await this.docClient.query(params).promise();
				entityUpdates = entityUpdates.concat(results.Items);

				// This is how we do paging!
				params.ExclusiveStartKey = results.LastEvaluatedKey;
				scannedCount += results.ScannedCount;
			}
			while ((entityUpdates.length < limit) && results.ScannedCount && results.LastEvaluatedKey);
			
			resolve(entityUpdates);
		});
	}

	/**
	 * Deletes failed entities that match a given id
	 * @param {string} entity The entity to query updates for e.g. candidate 
	 * @param {array} ids A list of ids of entities you wish to delete
	 * @returns {Promise} A promise when the entities have been removed
	 */
	async deleteBadEntities(entity, ids) {
		ids.forEach(async (id) => {
			await this.deleteEntityUpdate(entity, id, true);
		});
	}

	/**
	 * Configurations format:
	 * [{ name: "Foo", engageExternalApi: "http://localhost:8000", bullhorn: [Object], ... }]
	 * @returns {Promise} A promise of all active configurations
	 */
	getAllIntegrations() {
		const params = {
			TableName: "PlaceImp-Integrations"
		};
		return this.docClient.scan(params).promise().then((response) => {
			// simplify the data format provided to clients
			response.Items.forEach((integration) => {
				integration.placementsImporter.candidateFields = integration.placementsImporter.candidateFields.values;
			});
			return Promise.resolve(response.Items);
		});
	}
}

module.exports = {
	DynamoDataStore: DynamoDataStore
};
