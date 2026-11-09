# cloud

Owner: Peyton.

- `template.yaml` AWS SAM stack `pd-stack`: DynamoDB tables, IoT policy and rules, Cognito, HTTP API, Lambda
- `lambda/pd_api/` the API Lambda (Node.js 22)
- `tools/` fake gateway and demo seeding scripts

Every cloud resource lives in `template.yaml`. Change it with a pull request, never in the console. Setup steps are in [../docs/setup.md](../docs/setup.md), and the API reference is in [../docs/api.md](../docs/api.md).
