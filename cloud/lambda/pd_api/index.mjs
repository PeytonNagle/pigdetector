import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, paginateQuery } from '@aws-sdk/lib-dynamodb';
import { validate } from './lib/schemas.mjs';

const NODES = 'pd_nodes';
const LATEST = 'pd_latest';
const HISTORY = 'pd_history';
const HISTORY_LIMIT = 300;
const HISTORY_MAX = 1000;
const PHOENIX_OFFSET_MS = -7 * 3600 * 1000;
const ONLINE_MS = 20000;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const fail = (statusCode, code, message) => reply(statusCode, { error: { code, message } });

const getLatest = async (deviceId) => (await db.send(new GetCommand({ TableName: LATEST, Key: { deviceId } }))).Item;

// latest is undefined when the node has no pd_latest row; the api/node check then rejects it.
function toApiNode({ deviceId, name, type, createdAt, pigHours }, latest, now) {
  if (!latest) return { deviceId, name, type, createdAt, pigHours, online: false, latest };
  const { deviceId: _id, type: _type, v: _v, source: _source, ...status } = latest;
  return { deviceId, name, type, createdAt, pigHours, online: now - status.ts < ONLINE_MS, latest: status };
}

// A node whose stored state breaks the contract (e.g. re-flashed as the other type) is left out
// so it can't blank the dashboard; the log line feeds the ApiInvalidNode alarm.
function isValidNode(node) {
  try {
    validate('api/node', node);
    return true;
  } catch (err) {
    console.error(JSON.stringify({ event: 'invalid_node', deviceId: node.deviceId, reason: err.message }));
    return false;
  }
}

async function listNodes(sub) {
  const owned = [];
  const pages = paginateQuery(
    { client: db },
    { TableName: NODES, IndexName: 'byOwner', KeyConditionExpression: 'ownerSub = :sub', ExpressionAttributeValues: { ':sub': sub } },
  );
  for await (const page of pages) owned.push(...page.Items);
  const latests = await Promise.all(owned.map((node) => getLatest(node.deviceId)));
  // Read the clock after the reads, so a slow read can't report a stale node as online.
  const now = Date.now();
  const nodes = owned.map((node, i) => toApiNode(node, latests[i], now));
  return reply(200, { nodes: nodes.filter(isValidNode).sort((a, b) => a.createdAt - b.createdAt) });
}

// Returns the error response instead of throwing, so a bad body stays a 400 rather than the handler's 500.
function parseRegisterBody({ body, isBase64Encoded }) {
  let data;
  try {
    data = JSON.parse(isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
  } catch {
    return { error: fail(400, 'invalid_body', 'body must be JSON') };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { error: fail(400, 'invalid_body', 'body must be a JSON object') };
  }
  const deviceId = typeof data.deviceId === 'string' ? data.deviceId.trim().toLowerCase() : data.deviceId;
  const name = typeof data.name === 'string' ? data.name.trim() : data.name;
  try {
    return { request: validate('api/register-request', { deviceId, name: name === undefined ? deviceId : name }) };
  } catch (err) {
    const badId = err.errors?.some((e) => e.instancePath === '/deviceId');
    return { error: fail(400, badId ? 'invalid_device_id' : 'invalid_body', err.message) };
  }
}

// The type comes from the node's last message, so a node must report before it can be registered.
async function registerNode(sub, event) {
  const { request, error } = parseRegisterBody(event);
  if (error) return error;
  const { deviceId, name } = request;
  const latest = await getLatest(deviceId);
  if (!latest) return fail(422, 'node_not_seen', `no message from ${deviceId} yet`);
  const item = { v: 1, deviceId, ownerSub: sub, type: latest.type, name, createdAt: Date.now(), pigHours: null };
  const apiNode = toApiNode(item, latest, item.createdAt);
  // The rule checks only type and fields; storing a node GET /nodes would leave out strands it behind a 409.
  if (!isValidNode(apiNode)) return fail(422, 'node_not_seen', `last message from ${deviceId} is invalid`);
  const node = validate('db/node', item);
  try {
    await db.send(new PutCommand({ TableName: NODES, Item: node, ConditionExpression: 'attribute_not_exists(deviceId)' }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return fail(409, 'already_registered', `${deviceId} is already registered`);
    throw err;
  }
  return reply(201, apiNode);
}

// Phoenix has no DST, so a fixed UTC-7 offset is exact. The window may cross midnight.
function inPigHours(ts, { start, end }) {
  const d = new Date(ts + PHOENIX_OFFSET_MS);
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return start < end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

// Only an opening row (door just opened) gets a pig verdict; every other door row is null.
function toHistoryItem({ deviceId: _id, type, v: _v, ...item }, pigHours) {
  if (type !== 'door') return item;
  const opening = item.door === 'open' && item.openSec === 0;
  return { ...item, pig: opening ? pigHours !== null && inPigHours(item.ts, pigHours) : null };
}

const toInt = (value, fallback) => (value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN);

function parseHistoryQuery(params = {}) {
  const from = toInt(params.from, 0);
  const to = toInt(params.to, Number.MAX_SAFE_INTEGER);
  const limit = toInt(params.limit, HISTORY_LIMIT);
  if ([from, to, limit].some(Number.isNaN) || from > to || limit < 1 || limit > HISTORY_MAX) return null;
  return { from, to, limit };
}

// Newest first. The node must belong to the caller; anyone else's node reads as not found.
async function getHistory(sub, event) {
  const deviceId = event.pathParameters?.deviceId;
  if (!/^pd-[0-9a-f]{8}$/.test(deviceId ?? '')) return fail(400, 'invalid_device_id', 'deviceId must be pd- plus 8 hex digits');
  const query = parseHistoryQuery(event.queryStringParameters ?? undefined);
  if (!query) return fail(400, 'invalid_query', `from and to must be ms, from <= to, limit 1 to ${HISTORY_MAX}`);
  const node = (await db.send(new GetCommand({ TableName: NODES, Key: { deviceId } }))).Item;
  if (!node || node.ownerSub !== sub) return fail(404, 'node_not_found', `${deviceId} is not one of your nodes`);
  const { Items } = await db.send(new QueryCommand({
    TableName: HISTORY,
    KeyConditionExpression: 'deviceId = :d AND ts BETWEEN :from AND :to',
    ExpressionAttributeValues: { ':d': deviceId, ':from': query.from, ':to': query.to },
    ScanIndexForward: false,
    Limit: query.limit,
  }));
  return reply(200, { items: Items.map((item) => toHistoryItem(item, node.pigHours)) });
}

const routes = { 'GET /nodes': listNodes, 'POST /nodes': registerNode, 'GET /nodes/{deviceId}/history': getHistory };

export async function handler(event) {
  try {
    const route = routes[event?.routeKey];
    if (!route) throw new Error(`no route for ${event?.routeKey}`);
    return await route(event.requestContext.authorizer.jwt.claims.sub, event);
  } catch (err) {
    console.error(err);
    return fail(500, 'internal', 'internal error');
  }
}
