import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../index.mjs';
import { validate } from '../lib/schemas.mjs';
import dbDoor from '../../../../fixtures/db/node.door.json' with { type: 'json' };
import dbTemp from '../../../../fixtures/db/node.temp.json' with { type: 'json' };
import latestTemp from '../../../../fixtures/db/latest.temp.json' with { type: 'json' };
import apiDoor from '../../../../fixtures/api/node.door.json' with { type: 'json' };
import apiTemp from '../../../../fixtures/api/node.temp.json' with { type: 'json' };
import twoNodes from '../../../../fixtures/api/nodes.two-nodes.json' with { type: 'json' };
import registerTemp from '../../../../fixtures/api/register-request.temp.json' with { type: 'json' };
import registerNoName from '../../../../fixtures/api/register-request.no-name.json' with { type: 'json' };
import alreadyRegistered from '../../../../fixtures/api/errors/error.already-registered.json' with { type: 'json' };
import notSeen from '../../../../fixtures/api/errors/error.node-not-seen.json' with { type: 'json' };
import dbHistoryDoor from '../../../../fixtures/db/history.door.json' with { type: 'json' };
import apiHistoryDoor from '../../../../fixtures/api/history.door.json' with { type: 'json' };
import apiHistoryTemp from '../../../../fixtures/api/history.temp.json' with { type: 'json' };

const SUB = dbDoor.ownerSub;
const NOW = 1763164805000;
const latestDoor = { v: 1, deviceId: dbDoor.deviceId, type: 'door', ...apiDoor.latest, source: 'live' };
const nodeTemp = { ...dbTemp, name: apiTemp.name };

let nodes;
let latest;
let history;
let sent;
let putError;

beforeEach(() => {
  nodes = {};
  latest = {};
  history = [];
  sent = [];
  putError = null;
  // Hooks also run around subtests, inside a test whose mocks are still on.
  mock.restoreAll();
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  mock.method(DynamoDBDocumentClient.prototype, 'send', async (command) => {
    sent.push(command);
    const input = command.input;
    if (command instanceof QueryCommand && input.TableName === 'pd_history') {
      const { ':d': d, ':from': from, ':to': to } = input.ExpressionAttributeValues;
      const rows = history.filter((h) => h.deviceId === d && h.ts >= from && h.ts <= to).sort((a, b) => b.ts - a.ts);
      return { Items: rows.slice(0, input.Limit) };
    }
    if (command instanceof QueryCommand) {
      const sub = input.ExpressionAttributeValues[':sub'];
      return { Items: Object.values(nodes).filter((n) => n.ownerSub === sub) };
    }
    if (command instanceof GetCommand) return { Item: (input.TableName === 'pd_nodes' ? nodes : latest)[input.Key.deviceId] };
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

const call = async (routeKey, body, extra = {}) => {
  const res = await handler({
    ...extra,
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


test('POST /nodes registers a seen node to the caller', async () => {
  latest = { [dbTemp.deviceId]: latestTemp };
  const res = await call('POST /nodes', registerTemp);
  validate('api/node', res.body);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { ...apiTemp, createdAt: NOW });
  const put = sent.find((c) => c instanceof PutCommand).input;
  validate('db/node', put.Item);
  assert.equal(put.TableName, 'pd_nodes');
  assert.equal(put.Item.ownerSub, SUB);
  assert.equal(put.Item.type, latestTemp.type);
  assert.equal(put.ConditionExpression, 'attribute_not_exists(deviceId)');
});

test('POST /nodes trims and lowercases the device ID', async () => {
  latest = { [dbTemp.deviceId]: latestTemp };
  const res = await call('POST /nodes', { deviceId: '  PD-8B21E4D0 ' });
  assert.equal(res.status, 201);
  assert.equal(res.body.deviceId, 'pd-8b21e4d0');
  assert.ok(nodes['pd-8b21e4d0']);
});

test('POST /nodes names the node after its ID when no name is given', async () => {
  latest = { [dbTemp.deviceId]: latestTemp };
  const res = await call('POST /nodes', registerNoName);
  assert.equal(res.status, 201);
  assert.equal(nodes[dbTemp.deviceId].name, dbTemp.deviceId);
});

test('POST /nodes rejects bad bodies', async (t) => {
  // Each case names the code it should get, so a case can't pass by failing for another reason.
  const cases = {
    'ID not matching the pattern': [{ deviceId: 'pd-xyz' }, 'invalid_device_id'],
    'numeric ID': [{ deviceId: 12345678 }, 'invalid_device_id'],
    'bad ID and bad name': [{ deviceId: 'nope', name: '' }, 'invalid_device_id'],
    'not JSON': ['{deviceId:', 'invalid_body'],
    'no body': [undefined, 'invalid_body'],
    'null body': ['null', 'invalid_body'],
    'array body': [[registerTemp], 'invalid_body'],
    'missing ID': [{ name: 'Fridge' }, 'invalid_body'],
    'blank name': [{ ...registerTemp, name: '   ' }, 'invalid_body'],
    'name over 40 characters': [{ ...registerTemp, name: 'x'.repeat(41) }, 'invalid_body'],
    'numeric name': [{ ...registerTemp, name: 7 }, 'invalid_body'],
  };
  for (const [name, [body, code]] of Object.entries(cases)) {
    await t.test(name, async () => {
      latest = { [dbTemp.deviceId]: latestTemp };
      expectError(await call('POST /nodes', body), 400, code);
      assert.equal(sent.length, 0);
    });
  }
});

test('POST /nodes refuses a node any account already registered', async () => {
  latest = { [dbTemp.deviceId]: latestTemp };
  putError = new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
  const res = await call('POST /nodes', registerTemp);
  expectError(res, 409, 'already_registered');
  assert.deepEqual(res.body, alreadyRegistered);
});

test('POST /nodes refuses a node the cloud has never heard from', async () => {
  const res = await call('POST /nodes', registerTemp);
  expectError(res, 422, 'node_not_seen');
  assert.deepEqual(res.body, notSeen);
  assert.equal(sent.some((c) => c instanceof PutCommand), false);
});

test('POST /nodes refuses a node whose last message breaks the contract', async (t) => {
  // Each would store a node that GET /nodes then leaves out forever, while a retry gets 409.
  const { limits: _limits, ...noLimits } = latestTemp;
  const cases = {
    'missing limits': noLimits,
    'unknown type': { ...latestTemp, type: 'Temp' },
  };
  for (const [name, badLatest] of Object.entries(cases)) {
    await t.test(name, async () => {
      latest = { [dbTemp.deviceId]: badLatest };
      expectError(await call('POST /nodes', registerTemp), 422, 'node_not_seen');
      assert.equal(sent.some((c) => c instanceof PutCommand), false);
    });
  }
});

const HISTORY_ROUTE = 'GET /nodes/{deviceId}/history';
const getHistory = (deviceId, query) => call(HISTORY_ROUTE, undefined, { pathParameters: { deviceId }, queryStringParameters: query });
const tempRows = () => apiHistoryTemp.items.map((item) => ({ v: 1, deviceId: dbTemp.deviceId, type: 'temp', ...item }));

test('GET history returns the caller\'s readings newest first, without deviceId, type or v', async () => {
  nodes = { [dbTemp.deviceId]: nodeTemp };
  history = [...tempRows()].reverse();
  const res = await getHistory(dbTemp.deviceId);
  validate('api/history', res.body);
  assert.deepEqual(res, { status: 200, body: apiHistoryTemp });
});

test('GET history gives a pig verdict only on door openings inside pig hours', async () => {
  nodes = { [dbDoor.deviceId]: dbDoor };
  const later = { ...dbHistoryDoor, ts: dbHistoryDoor.ts + 5000, openSec: 5 };
  history = [dbHistoryDoor, later];
  const res = await getHistory(dbDoor.deviceId);
  validate('api/history', res.body);
  assert.deepEqual(res.body, apiHistoryDoor);
  nodes = { [dbDoor.deviceId]: { ...dbDoor, pigHours: { start: '08:00', end: '09:00' } } };
  assert.equal((await getHistory(dbDoor.deviceId)).body.items[1].pig, false);
});

test('GET history applies from, to and limit', async () => {
  nodes = { [dbTemp.deviceId]: nodeTemp };
  history = tempRows();
  const [newest, oldest] = apiHistoryTemp.items;
  assert.deepEqual((await getHistory(dbTemp.deviceId, { limit: '1' })).body.items, [newest]);
  assert.deepEqual((await getHistory(dbTemp.deviceId, { to: String(oldest.ts) })).body.items, [oldest]);
  assert.deepEqual((await getHistory(dbTemp.deviceId, { from: String(newest.ts + 1) })).body, { items: [] });
});

test('GET history hides nodes the caller doesn\'t own', async (t) => {
  const cases = {
    'another account\'s node': { [dbTemp.deviceId]: { ...nodeTemp, ownerSub: '00000000-0000-4000-8000-000000000000' } },
    'unregistered node': {},
  };
  for (const [name, owned] of Object.entries(cases)) {
    await t.test(name, async () => {
      nodes = owned;
      history = tempRows();
      expectError(await getHistory(dbTemp.deviceId), 404, 'node_not_found');
      assert.equal(sent.some((c) => c instanceof QueryCommand), false);
    });
  }
});

test('GET history rejects bad IDs and queries', async (t) => {
  const cases = {
    'bad ID': ['pd-xyz', {}, 'invalid_device_id'],
    'non-numeric from': [dbTemp.deviceId, { from: 'yesterday' }, 'invalid_query'],
    'from after to': [dbTemp.deviceId, { from: '10', to: '5' }, 'invalid_query'],
    'limit 0': [dbTemp.deviceId, { limit: '0' }, 'invalid_query'],
    'limit over 1000': [dbTemp.deviceId, { limit: '1001' }, 'invalid_query'],
  };
  for (const [name, [deviceId, query, code]] of Object.entries(cases)) {
    await t.test(name, async () => {
      nodes = { [dbTemp.deviceId]: nodeTemp };
      expectError(await getHistory(deviceId, query), 400, code);
      assert.equal(sent.length, 0);
    });
  }
});
