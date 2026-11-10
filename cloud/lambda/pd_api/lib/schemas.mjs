// Checks items against the shared schemas in fixtures/schemas/.
// Static imports let esbuild inline the files; samconfig.toml builds in source so these paths resolve.
import Ajv from 'ajv/dist/2020.js';
import common from '../../../../fixtures/schemas/common.schema.json' with { type: 'json' };
import node from '../../../../fixtures/schemas/db/node.schema.json' with { type: 'json' };

// Keyed by path under fixtures/schemas/, without .schema.json.
const schemas = { common, 'db/node': node };

const ajv = new Ajv({ allErrors: true, useDefaults: true, schemas: Object.values(schemas) });

// Compile now, so a broken schema fails the cold start instead of a request.
const validators = Object.fromEntries(Object.entries(schemas).map(([name, s]) => [name, ajv.getSchema(s.$id)]));

// Returns a copy with defaults filled in; throws if the item breaks the schema.
export function validate(name, item) {
  const check = validators[name];
  if (!check) throw new Error(`no schema named ${name}`);
  // Deep copy: useDefaults fills nested objects too, and the caller's input must not change.
  const copy = structuredClone(item);
  if (!check(copy)) throw new Error(`invalid ${name}: ${ajv.errorsText(check.errors)}`);
  return copy;
}
