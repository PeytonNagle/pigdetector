// Checks items against the shared schemas in fixtures/schemas/.
// Static imports let esbuild inline the files; samconfig.toml builds in source so these paths resolve.
import Ajv from 'ajv/dist/2020.js';
import common from '../../../../fixtures/schemas/common.schema.json' with { type: 'json' };
import node from '../../../../fixtures/schemas/db/node.schema.json' with { type: 'json' };
import latest from '../../../../fixtures/schemas/db/latest.schema.json' with { type: 'json' };
import state from '../../../../fixtures/schemas/mqtt/state.schema.json' with { type: 'json' };
import apiNode from '../../../../fixtures/schemas/api/node.schema.json' with { type: 'json' };
import apiNodes from '../../../../fixtures/schemas/api/nodes.schema.json' with { type: 'json' };
import history from '../../../../fixtures/schemas/api/history.schema.json' with { type: 'json' };
import registerRequest from '../../../../fixtures/schemas/api/register-request.schema.json' with { type: 'json' };
import apiError from '../../../../fixtures/schemas/api/errors/error.schema.json' with { type: 'json' };

// Keyed by path under fixtures/schemas/, without .schema.json.
const schemas = {
  common,
  'db/node': node,
  'db/latest': latest,
  'mqtt/state': state,
  'api/node': apiNode,
  'api/nodes': apiNodes,
  'api/history': history,
  'api/register-request': registerRequest,
  'api/errors/error': apiError,
};

const ajv = new Ajv({ allErrors: true, useDefaults: true, schemas: Object.values(schemas) });

// Compile now, so a broken schema fails the cold start instead of a request.
const validators = Object.fromEntries(Object.entries(schemas).map(([name, s]) => [name, ajv.getSchema(s.$id)]));

// Returns a copy with defaults filled in; throws if the item breaks the schema.
// The thrown error carries ajv's errors, so callers can tell which field failed.
export function validate(name, item) {
  const check = validators[name];
  if (!check) throw new Error(`no schema named ${name}`);
  // Deep copy: useDefaults fills nested objects too, and the caller's input must not change.
  const copy = structuredClone(item);
  if (!check(copy)) {
    throw Object.assign(new Error(`invalid ${name}: ${ajv.errorsText(check.errors)}`), { errors: check.errors });
  }
  return copy;
}
