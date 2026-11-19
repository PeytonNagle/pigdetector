# PigDetector API

The HTTP API the web app uses to list and register nodes. This page covers the milestone routes `GET /nodes` and `POST /nodes`.

The contracts live in [`fixtures/schemas/api/`](../fixtures/schemas/api/), and every example below is copied from [`fixtures/api/`](../fixtures/api/). If this page and the fixtures disagree, the fixtures win.

## Basics

| | |
|---|---|
| Base URL | The `ApiUrl` output of stack `pd-stack` (`https://{api-id}.execute-api.us-west-1.amazonaws.com`) |
| Auth | Every route needs `Authorization: Bearer <token>`, where the token is a Cognito ID or access token from user pool `us-west-1_UAbK8omG2`, app client `53ag8m9ir3lggeb4qo0p53arbp` |
| CORS origins | `https://main.dc3k8sg5zaosx.amplifyapp.com`, `http://localhost:5500` |
| Bodies | JSON, `Content-Type: application/json` |
| Times | Whole milliseconds since 1970 |

Find the base URL with:

```bash
aws cloudformation describe-stacks --stack-name pd-stack --region us-west-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text
```

The API identifies the caller by the token's `sub` claim. A user only ever sees and registers nodes under their own account.

## Errors

API Gateway rejects a missing, expired, or invalid token before it reaches the Lambda, and the body is not the format below:

```
401 {"message":"Unauthorized"}
```

Every other error uses one shape ([schema](../fixtures/schemas/api/errors/error.schema.json)). `message` is for developers. The UI should choose its own words based on `code`.

```json
{ "error": { "code": "node_not_seen", "message": "no message from pd-8b21e4d0 yet" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_body` | The body is missing, isn't JSON, isn't an object, has no `deviceId`, or has a bad `name` |
| 400 | `invalid_device_id` | `deviceId` isn't `pd-` plus 8 hex digits |
| 409 | `already_registered` | Some account already owns this node, whether yours or someone else's |
| 422 | `node_not_seen` | The cloud has never received a message from this node |
| 500 | `internal` | Something failed on the server. Retry later |

## GET /nodes

Lists the signed-in user's nodes, oldest registration first. The dashboard polls this every 5 s. The tables are sized for about one dashboard polling at that rate, so more tabs or faster polling may be throttled and get `500`.

**Request:** no parameters or body.

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/nodes"
```

**Response `200`** ([schema](../fixtures/schemas/api/nodes.schema.json)), from [`nodes.two-nodes.json`](../fixtures/api/nodes.two-nodes.json):

```json
{
  "nodes": [
    {
      "deviceId": "pd-3f9a1c2b",
      "name": "Fridge door",
      "type": "door",
      "createdAt": 1762900000000,
      "pigHours": { "start": "23:00", "end": "05:00" },
      "online": true,
      "latest": {
        "ts": 1763164800123,
        "mode": "auto",
        "led": true,
        "door": "open",
        "openSec": 34,
        "limits": { "openMaxSec": 30 },
        "ack": "c-k3j9x2pq",
        "ackErr": null
      }
    },
    {
      "deviceId": "pd-8b21e4d0",
      "name": "Fridge temp",
      "type": "temp",
      "createdAt": 1762900100000,
      "pigHours": null,
      "online": true,
      "latest": {
        "ts": 1763164802456,
        "mode": "manual",
        "led": false,
        "tempC": 4.31,
        "limits": { "tempMaxC": 4.4 },
        "ack": null,
        "ackErr": null
      }
    }
  ]
}
```

A user with no nodes gets an empty list, never a 404 ([`nodes.none.json`](../fixtures/api/nodes.none.json)):

```json
{ "nodes": [] }
```

Node fields ([schema](../fixtures/schemas/api/node.schema.json)):

| Field | Meaning |
|---|---|
| `deviceId` | `pd-` plus 8 lowercase hex digits |
| `name` | Dashboard label, 1 to 40 characters |
| `type` | `door` or `temp`, taken from the node's latest message when it was registered |
| `createdAt` | When the node was registered |
| `pigHours` | Door nodes: `{start, end}` in Phoenix time, `HH:MM`, or `null` until set. Temp nodes: always `null` |
| `online` | `true` if `latest.ts` is less than 20 s old |
| `latest` | The node's last reported state. It's always present, because a node can't be registered before it reports. Door nodes have `door`, `openSec`, `limits.openMaxSec`. Temp nodes have `tempC` (`null` if the probe failed) and `limits.tempMaxC` |

A node whose stored data doesn't fit this shape is left out of the list, not returned half-broken. That happens if a node was re-flashed as the other type, or if its latest state was deleted. The Lambda logs `invalid_node` and the `pd-api-invalid-nodes` alarm emails `pd-alerts`.

`type` is fixed when the node is registered. To change a node's type, delete its item from `pd_nodes` and register it again.

## POST /nodes

Registers a node to the signed-in user. The node must have sent at least one message through the gateway first, because its type comes from its latest message. Add the `201` body to the dashboard's list directly: a `GET /nodes` right after can miss the new node for a moment.

**Request body** ([schema](../fixtures/schemas/api/register-request.schema.json)):

| Field | Required | Rules |
|---|---|---|
| `deviceId` | yes | Trimmed and lowercased, then must match `^pd-[0-9a-f]{8}$` (so `" PD-8B21E4D0"` is accepted) |
| `name` | no | Trimmed, then 1 to 40 characters. Defaults to `deviceId` |

Unknown fields are ignored.

From [`register-request.temp.json`](../fixtures/api/register-request.temp.json):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "deviceId": "pd-8b21e4d0", "name": "Fridge temp" }' "$API_URL/nodes"
```

Without a name, from [`register-request.no-name.json`](../fixtures/api/register-request.no-name.json), the node is named `pd-8b21e4d0`:

```json
{ "deviceId": "pd-8b21e4d0" }
```

**Response `201`**: the new node, in the same shape as a `GET /nodes` item ([schema](../fixtures/schemas/api/node.schema.json)), from [`node.temp.json`](../fixtures/api/node.temp.json):

```json
{
  "deviceId": "pd-8b21e4d0",
  "name": "Fridge temp",
  "type": "temp",
  "createdAt": 1762900100000,
  "pigHours": null,
  "online": true,
  "latest": {
    "ts": 1763164802456,
    "mode": "manual",
    "led": false,
    "tempC": 4.31,
    "limits": { "tempMaxC": 4.4 },
    "ack": null,
    "ackErr": null
  }
}
```

**Errors:**

`409`, the node already belongs to an account (yours or another), from [`error.already-registered.json`](../fixtures/api/errors/error.already-registered.json):

```json
{ "error": { "code": "already_registered", "message": "pd-8b21e4d0 is already registered" } }
```

`422`, no message from the node has reached the cloud yet. Power it on near the gateway, wait a few seconds, and try again. Messages with a missing or unknown `type`, or with both door and temp fields, are dropped by the IoT rule, so a node sending those also gets `422`. A latest message that reached the cloud but breaks the contract (for example, no `limits`) gets `422` with `"last message from pd-8b21e4d0 is invalid"`. From [`error.node-not-seen.json`](../fixtures/api/errors/error.node-not-seen.json):

```json
{ "error": { "code": "node_not_seen", "message": "no message from pd-8b21e4d0 yet" } }
```

`400` with `invalid_device_id` or `invalid_body`, the body broke a rule above (see [Errors](#errors)). These codes have no fixture file. The body has the same shape, for example:

```json
{ "error": { "code": "invalid_device_id", "message": "deviceId must be pd- plus 8 hex digits" } }
```
