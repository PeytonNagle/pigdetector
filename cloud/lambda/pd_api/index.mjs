import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, paginateQuery } from '@aws-sdk/lib-dynamodb';
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

const routes = { 'GET /nodes': listNodes };

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
