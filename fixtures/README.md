# fixtures

The contracts between the three parts of the system, as JSON Schemas plus real examples. The fake gateway, the web mock API and the Lambda tests all read these files.

- `schemas/` JSON Schemas for every message and API response
- `mqtt/` example messages on the gateway ↔ IoT Core topics (contract C2)
- `api/` example REST API responses, with `errors/` (contract C4)

**Rule:** if the build spec and these files disagree, these files win. Changing a file here needs a yes from the person on the other side of that contract.
