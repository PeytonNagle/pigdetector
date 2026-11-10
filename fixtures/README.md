# fixtures

The contracts between firmware, cloud and web. Each contract has **rules** (a JSON Schema) and **examples** (real data that follows the rules). If the build spec and these files disagree, these files win. Changing one needs a yes from the person on the other side of that contract.

## Rules and examples

Rules live under `schemas/`. Examples live in the folder with the same name outside it:

| Contract | Rules | Examples |
|---|---|---|
| DynamoDB items (C3) | `schemas/db/` | `db/` |
| MQTT messages (C2) | `schemas/mqtt/` | `mqtt/` |
| API responses (C4) | `schemas/api/` | `api/` |

An example is named `<schema>.<case>.json`. The part before the first dot picks the schema, and the rest names the case:

```
db/node.door.json  →  schemas/db/node.schema.json
```

Each schema needs at least one example. Examples spell out every field, defaults included, since other code copies them. `schemas/common.schema.json` holds shared pieces (IDs, timestamps, node kind), which other schemas use with `$ref`.

## Writing a schema

- Use JSON Schema draft 2020-12. Set `$id` to `https://schemas.pigdetector.invalid/` plus the path under `schemas/`. Nothing is fetched from it.
- Times are whole milliseconds since 1970.
- Give a field a `default` only when leaving it out means something. Never invent a reading or a state.
- Stored items have a version field `v`. For a change that breaks old items, bump `v` and add a Lambda step that upgrades older items when it reads them.

## Checking

`npm test` from the repo root checks every example against its schema. CI runs it on every pull request.
