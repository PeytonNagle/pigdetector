import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../index.mjs';
import { validate } from '../lib/schemas.mjs';
import dbDoor from '../../../../fixtures/db/node.door.json' with { type: 'json' };
import dbTemp from '../../../../fixtures/db/node.temp.json' with { type: 'json' };
import latestTemp from '../../../../fixtures/db/latest.temp.json' with { type: 'json' };
import apiDoor from '../../../../fixtures/api/node.door.json' with { type: 'json' };
import apiTemp from '../../../../fixtures/api/node.temp.json' with { type: 'json' };
import twoNodes from '../../../../fixtures/api/nodes.two-nodes.json' with { type: 'json' };

const SUB = dbDoor.ownerSub;
const NOW = 1763164805000;
const latestDoor = { v: 1, deviceId: dbDoor.deviceId, type: 'door', ...apiDoor.latest, source: 'live' };
const nodeTemp = { ...dbTemp, name: apiTemp.name };

// Fake tables, keyed by deviceId; each test fills them.
let nodes;
let latest;
let sent;
let putError;

beforeEach(() => {
  nodes = {};
  latest = {};
  sent = [];
  putError = null;
  // Hooks also run around subtests, inside a test whose mocks are still on.
  mock.restoreAll();
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  mock.method(DynamoDBDocumentClient.prototype, 'send', async (command) => {
    sent.push(command);
    const input = command.input;
    if (command instanceof QueryCommand) {
      const sub = input.ExpressionAttributeValues[':sub'];
      return { Items: Object.values(nodes).filter((n) => n.ownerSub === sub) };
    }
    if (command instanceof GetCommand) return { Item: latest[input.Key.deviceId] };
    if (command instanceof PutCommand) {
      if (putError) throw putError;
      nodes[input.Item.deviceId] = input.Item;
      return {};
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  });
});

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

const call = async (routeKey, body) => {
  const res = await handler({
    routeKey,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { authorizer: { jwt: { claims: { sub: SUB } } } },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

// Every response must match its contract, whatever the test checks next.
const expectError = (res, status, code) => {
  validate('api/errors/error', res.body);
  assert.equal(res.status, status);
  assert.equal(res.body.error.code, code);
};

test('GET /nodes joins the caller\'s nodes with their latest state', async () => {
  nodes = { [dbTemp.deviceId]: nodeTemp, [dbDoor.deviceId]: dbDoor, 'pd-99999999': { ...dbDoor, deviceId: 'pd-99999999', ownerSub: '00000000-0000-4000-8000-000000000000' } };
  latest = { [dbDoor.deviceId]: latestDoor, [dbTemp.deviceId]: latestTemp };
  const res = await call('GET /nodes');
  validate('api/nodes', res.body);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, twoNodes);
  const query = sent.find((c) => c instanceof QueryCommand).input;
  assert.equal(query.IndexName, 'byOwner');
  assert.equal(query.ExpressionAttributeValues[':sub'], SUB);
});

test('GET /nodes marks a node offline when its latest state is 20 s old', async () => {
  nodes = { [dbDoor.deviceId]: dbDoor };
  latest = { [dbDoor.deviceId]: { ...latestDoor, ts: NOW - 20000 } };
  const res = await call('GET /nodes');
  validate('api/nodes', res.body);
  assert.equal(res.body.nodes[0].online, false);
});

test('GET /nodes returns an empty list when the caller has no nodes', async () => {
  const res = await call('GET /nodes');
  validate('api/nodes', res.body);
  assert.deepEqual(res, { status: 200, body: { nodes: [] } });
});

test('GET /nodes leaves out a bad node and logs it', async (t) => {
  const cases = {
    'type changed since registration': { ...latestTemp, deviceId: dbDoor.deviceId },
    'no latest row': undefined,
  };
  for (const [name, badLatest] of Object.entries(cases)) {
    await t.test(name, async () => {
      const log = mock.method(console, 'error', () => {});
      nodes = { [dbDoor.deviceId]: dbDoor, [dbTemp.deviceId]: nodeTemp };
      latest = { [dbDoor.deviceId]: badLatest, [dbTemp.deviceId]: latestTemp };
      const res = await call('GET /nodes');
      validate('api/nodes', res.body);
      assert.deepEqual(res.body, { nodes: [apiTemp] });
      assert.equal(log.mock.callCount(), 1);
      assert.deepEqual(
        { event: 'invalid_node', deviceId: dbDoor.deviceId },
        (({ event, deviceId }) => ({ event, deviceId }))(JSON.parse(log.mock.calls[0].arguments[0])),
      );
    });
  }
});

