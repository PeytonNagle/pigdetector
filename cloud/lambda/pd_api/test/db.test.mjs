import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../lib/db.mjs';
import { ValidationError } from '../lib/schemas.mjs';
import door from '../../../../fixtures/db/node.door.json' with { type: 'json' };
import temp from '../../../../fixtures/db/node.temp.json' with { type: 'json' };

// Stands in for DynamoDBDocumentClient: records each command and returns a canned reply.
function fakeClient(reply = {}) {
  const sent = [];
  return { sent, send: async (command) => (sent.push(command.input), reply) };
}

const tables = { nodes: 'pd_nodes' };

test('getNode returns the stored node, or null when missing', async () => {
  assert.deepEqual(await createDb({ client: fakeClient({ Item: door }), tables }).getNode('pd-door-01'), door);
  assert.equal(await createDb({ client: fakeClient({}), tables }).getNode('pd-door-01'), null);
});

test('getNode throws on a stored item that breaks the schema', async () => {
  const db = createDb({ client: fakeClient({ Item: { ...door, createdAt: 'yesterday' } }), tables });
  await assert.rejects(db.getNode('pd-door-01'), ValidationError);
});

test('listNodesByOwner queries the byOwner index', async () => {
  const client = fakeClient({ Items: [door, temp] });
  const nodes = await createDb({ client, tables }).listNodesByOwner(door.ownerSub);
  assert.deepEqual(nodes, [door, temp]);
  assert.equal(client.sent[0].IndexName, 'byOwner');
  assert.equal(client.sent[0].ExpressionAttributeValues[':owner'], door.ownerSub);
});

test('putNode fills defaults and refuses to overwrite a registered device', async () => {
  const client = fakeClient();
  const { v, ...withoutVersion } = door;
  const saved = await createDb({ client, tables }).putNode(withoutVersion);
  assert.equal(saved.v, 1);
  assert.deepEqual(client.sent[0].Item, saved);
  assert.equal(client.sent[0].ConditionExpression, 'attribute_not_exists(deviceId)');
});

test('putNode sends nothing when the node is invalid', async () => {
  const client = fakeClient();
  await assert.rejects(createDb({ client, tables }).putNode({ ...door, kind: 'humidity' }), ValidationError);
  assert.equal(client.sent.length, 0);
});
