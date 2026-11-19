# PigDetector

ECE 413/513 final project, Fall 2026. PigDetector watches a fridge: a door node and a temperature node (nRF52840) report over BLE to an ESP32-S3 gateway, which publishes to AWS IoT Core. AWS stores the readings in DynamoDB and serves them through API Gateway and Lambda to a web app, where users can watch both nodes and send commands back.

**Team:** Wonhee (IoT) · Peyton (backend) · Nisha (frontend)

## Links

- Build spec (plan, contracts, task status): https://claude.ai/artifact/MVGv1zZJjZ2ogyUqrwEXvJ
- Live site: https://main.dc3k8sg5zaosx.amplifyapp.com
- Pitch video: _TBD_
- Demo video: _TBD_

## Demo login

An account with recently collected data, for graders.

- Email: `demo@example.com`
- Password: `DemoPassword%1`

## Project structure

```
pigdetector/
├── fixtures/          shared contracts: JSON Schemas and example messages
│   ├── schemas/
│   ├── db/            example DynamoDB items
│   ├── mqtt/          example MQTT state and command messages
│   └── api/           example API responses (+ errors/)
├── firmware/          Wonhee: nRF52840 nodes and ESP32-S3 gateway
│   ├── node/
│   └── gateway/
├── cloud/             Peyton: AWS SAM stack and the Node.js Lambda
│   ├── template.yaml
│   ├── lambda/pd_api/
│   └── tools/         fake gateway and demo seeding scripts
├── web/               Nisha: plain HTML, CSS and JS, hosted on Amplify
│   ├── css/
│   └── js/
├── test/              checks fixtures/ against the schemas (npm test)
├── docs/
│   ├── api.md         REST API reference
│   └── setup.md       setup and deploy steps
└── .githooks/         pre-commit secret scan
```

## Getting started

1. Install Node 22 (`nvm use` reads `.nvmrc`) and gitleaks (`brew install gitleaks`).
2. Run `npm install` at the repo root. This turns on the pre-commit hook that blocks keys and certificates.
3. See your folder's README for the rest.

## IoT (Wonhee)

See [firmware/README.md](firmware/README.md).

### Registering a real node

A node can only be registered after the cloud has received a message from it, because its type (`door` or `temp`) comes from that message.

1. Power on the gateway and the node, and keep the node within BLE range.
2. Find the node's device ID (`pd-` plus 8 lowercase hex digits). In the AWS IoT console (us-west-1), open **MQTT test client** and subscribe to `pigdetector/+/state`. Each message's topic and `deviceId` show the ID. A message that never shows up here hasn't reached the cloud.
3. Log in on the [live site](https://main.dc3k8sg5zaosx.amplifyapp.com), enter the device ID (and a name if you like), and click **Register node**.

Error messages on the site:

- **"The cloud hasn't heard from that node yet."** No valid message has arrived. The `pd_live` rule drops messages whose `deviceId` doesn't match the topic, whose `ts` isn't in milliseconds, or that mix door and temp fields.
- **"That node is already registered to an account."** Each node has one owner, the first account to register it. Register the demo nodes from the demo account.

A node's type is fixed at registration. If a node is re-flashed as the other type, delete its item from `pd_nodes` and register it again.

## Backend (Peyton)

See [cloud/README.md](cloud/README.md) and [docs/api.md](docs/api.md).

| What | Value |
|---|---|
| AWS Region | `us-west-1` |
| API base URL | https://z8c550rufd.execute-api.us-west-1.amazonaws.com ([docs/api.md](docs/api.md)) |
| Login page (Cognito) | https://pigdetector-828411126105.auth.us-west-1.amazoncognito.com |
| User pool / app client | `us-west-1_UAbK8omG2` / `53ag8m9ir3lggeb4qo0p53arbp` |
| IoT endpoint | `a1h01vt47w0y8q-ats.iot.us-west-1.amazonaws.com` |

None of these are secrets. Read them live with `aws cloudformation describe-stacks --stack-name pd-stack --region us-west-1 --query 'Stacks[0].Outputs'`.

## Frontend (Nisha)

See [web/README.md](web/README.md).

## Secrets

This repo is public. Certificates, private keys and passwords live only in git-ignored files (`secrets.h`, `.env`). Commit a `*.example` copy with blanks instead.

**IoT certificates** let a gateway connect to AWS IoT Core. The sensor nodes don't need one; they only talk BLE to the gateway. Certificates are never in this repo, so each person makes their own:

- Real gateway `pd-gw-01` (Wonhee): make a key and CSR, and Peyton signs it. The key stays in `firmware/gateway/secrets.h`.
- Fake gateway `pd-fake-gw` (anyone testing the backend): make your own certificate into `secrets/pd-fake-gw/` in the repo folder (git-ignored). It may only publish and receive commands for test device IDs `pd-0000xxxx`, so it can never overwrite or command a real node.

Commands for both are in the build spec's IoT tab, under Certificates.

## Submitting to D2L

Build the archive from what's committed, so no installed modules or secrets get in:

```bash
git archive --format=zip -o pigdetector.zip main
```

## References

Third-party libraries, APIs, tutorials and AI tools are listed on the site's References page (`web/references.html`).
