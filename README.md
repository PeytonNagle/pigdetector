# PigDetector

ECE 413/513 final project, Fall 2026. PigDetector watches a fridge: a door node and a temperature node (nRF52840) report over BLE to an ESP32-S3 gateway, which publishes to AWS IoT Core. AWS stores the readings in DynamoDB and serves them through API Gateway and Lambda to a web app, where users can watch both nodes and send commands back.

**Team:** Wonhee (IoT) · Peyton (backend) · Nisha (frontend)

## Links

- Live site: _TBD_
- Pitch video: _TBD_
- Demo video: _TBD_

## Demo login

An account with recently collected data, for graders.

- Email: _TBD_
- Password: _TBD_

## Project structure

```
pigdetector/
├── fixtures/          shared contracts: JSON Schemas and example messages
│   ├── schemas/
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

## Backend (Peyton)

See [cloud/README.md](cloud/README.md) and [docs/api.md](docs/api.md).

## Frontend (Nisha)

See [web/README.md](web/README.md).

## Secrets

This repo is public. Certificates, private keys and passwords live only in git-ignored files (`secrets.h`, `.env`). Commit a `*.example` copy with blanks instead.

## Submitting to D2L

Build the archive from what's committed, so no installed modules or secrets get in:

```bash
git archive --format=zip -o pigdetector.zip main
```

## References

Third-party libraries, APIs, tutorials and AI tools are listed on the site's References page (`web/references.html`).
