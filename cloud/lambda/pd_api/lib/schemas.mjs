// Validates items against the shared JSON Schemas in fixtures/schemas/.
// Static imports let esbuild inline the files; SAM must build in source for these paths to resolve.
import Ajv from 'ajv/dist/2020.js';
import common from '../../../../fixtures/schemas/common.schema.json' with { type: 'json' };
import node from '../../../../fixtures/schemas/db/node.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, useDefaults: true, schemas: [common, node] });

// Compiled at load, so a broken schema fails the cold start instead of a request.
const validators = {
  node: ajv.getSchema(node.$id),
};

export const schemaIds = [common.$id, node.$id];

export class ValidationError extends Error {
  constructor(entity, errors) {
    super(`invalid ${entity}: ${ajv.errorsText(errors)}`);
    this.name = 'ValidationError';
    this.entity = entity;
    this.errors = errors;
  }
}

// Returns a validated copy with defaults filled in; the input is never changed.
export function validate(entity, item) {
  const check = validators[entity];
  if (!check) throw new Error(`no schema for ${entity}`);
  const copy = structuredClone(item);
  if (!check(copy)) throw new ValidationError(entity, check.errors);
  return copy;
}
