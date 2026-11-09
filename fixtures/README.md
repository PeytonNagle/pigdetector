# fixtures

The contracts between the three parts of the system, as JSON Schemas plus real examples. The fake gateway, the web mock API and the Lambda tests all read these files, and the Lambda bundles the schemas to check data at runtime.

- `schemas/` JSON Schemas for every message, stored item and API response
- `db/` example DynamoDB items (contract C3)
- `mqtt/` example messages on the gateway ↔ IoT Core topics (contract C2)
- `api/` example REST API responses, with `errors/` (contract C4)

**Rule:** if the build spec and these files disagree, these files win. Changing a file here needs a yes from the person on the other side of that contract.

## Conventions

- Schemas use JSON Schema draft 2020-12. Each `$id` is `https://schemas.pigdetector.invalid/` plus the file's path under `schemas/`. Nothing is ever fetched from that address; `.invalid` is a reserved domain.
- Shared pieces (device ID, user ID, timestamp, node kind) live in `schemas/common.schema.json`. Point to them with `$ref`, such as `"../common.schema.json#/$defs/ts"`.
- Times are whole **milliseconds** since 1970. Schemas reject anything before 2020, which catches a value sent in seconds.
- Every stored item has a version field, `v`. When a shape changes, bump `v`'s `const` and `default` in the schema, and add a step in the Lambda that upgrades older items when it reads them.
- Give a field a `default` only when leaving it out has a real meaning. Never invent a reading or a state.
- An example is named `<schema>.<case>.json` and must match the schema with the same name in the matching folder: `db/node.door.json` → `schemas/db/node.schema.json`. Examples spell out every field, defaults included.

## Checking

From the repo root:

```bash
npm install
npm test
```

This checks that every schema compiles, every `$id` matches its path, every schema in a subfolder has an example, and every example matches its schema. CI runs it on every pull request.
