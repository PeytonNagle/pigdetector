// pd_nodes reads and writes. Every item is checked against fixtures/schemas/db/node.schema.json.
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { validate } from './schemas.mjs';

// client: a DynamoDBDocumentClient. tables: { nodes: 'pd_nodes' }.
export function createDb({ client, tables }) {
  return {
    async getNode(deviceId) {
      const { Item } = await client.send(new GetCommand({ TableName: tables.nodes, Key: { deviceId } }));
      return Item ? validate('node', Item) : null;
    },

    // A user owns a handful of nodes, so one page (up to 1 MB) is always enough.
    async listNodesByOwner(ownerSub) {
      const { Items = [] } = await client.send(
        new QueryCommand({
          TableName: tables.nodes,
          IndexName: 'byOwner',
          KeyConditionExpression: 'ownerSub = :owner',
          ExpressionAttributeValues: { ':owner': ownerSub },
        }),
      );
      return Items.map((item) => validate('node', item));
    },

    // Throws ConditionalCheckFailedException if the device is already registered.
    async putNode(node) {
      const item = validate('node', node);
      await client.send(
        new PutCommand({
          TableName: tables.nodes,
          Item: item,
          ConditionExpression: 'attribute_not_exists(deviceId)',
        }),
      );
      return item;
    },
  };
}
