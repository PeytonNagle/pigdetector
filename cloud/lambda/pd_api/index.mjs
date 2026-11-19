import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, paginateQuery } from '@aws-sdk/lib-dynamodb';
import { validate } from './lib/schemas.mjs';

const NODES = 'pd_nodes';
const LATEST = 'pd_latest';
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
  const now = Date.now();
  const nodes = await Promise.all(owned.map(async (node) => toApiNode(node, await getLatest(node.deviceId), now)));
  return reply(200, { nodes: nodes.filter(isValidNode).sort((a, b) => a.createdAt - b.createdAt) });
}

// Returns { request } with deviceId trimmed and lowercased and name defaulted, or { error } as a 400 response.
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
  const node = validate('db/node', { v: 1, deviceId, ownerSub: sub, type: latest.type, name, createdAt: Date.now(), pigHours: null });
  try {
    await db.send(new PutCommand({ TableName: NODES, Item: node, ConditionExpression: 'attribute_not_exists(deviceId)' }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return fail(409, 'already_registered', `${deviceId} is already registered`);
    throw err;
  }
  return reply(201, toApiNode(node, latest, node.createdAt));
}

const routes = { 'GET /nodes': listNodes, 'POST /nodes': registerNode };

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
