import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const ID_BASE = 'https://schemas.pigdetector.invalid/';

// Every .json under dir, as [posix path relative to dir, parsed JSON].
const load = (dir) =>
  readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.split(sep).join('/'), JSON.parse(readFileSync(join(dir, f), 'utf8'))]);

const schemas = load(join(FIXTURES, 'schemas'));
const examples = load(FIXTURES).filter(([path]) => !path.startsWith('schemas/'));

// No useDefaults: examples must spell out every field, since other teams copy them.
const ajv = new Ajv({ allErrors: true, schemas: schemas.map(([, s]) => s) });

// db/node.door.json -> https://schemas.pigdetector.invalid/db/node.schema.json
const schemaIdFor = (path) => `${ID_BASE}${dirname(path)}/${path.split('/').pop().split('.')[0]}.schema.json`;

for (const [path, schema] of schemas) {
  test(`schema ${path} compiles under its path`, () => assert.ok(ajv.getSchema(ID_BASE + path), '$id must match the path'));

  // Schemas that only hold $defs (like common) describe no data of their own.
  if (schema.type || schema.$ref || schema.properties) {
    test(`schema ${path} has an example`, () =>
      assert.ok(examples.some(([p]) => schemaIdFor(p) === ID_BASE + path)));
  }
}

for (const [path, example] of examples) {
  test(`example ${path} matches its schema`, () => {
    const validate = ajv.getSchema(schemaIdFor(path));
    assert.ok(validate, `no schema at ${schemaIdFor(path)}`);
    assert.ok(validate(example), ajv.errorsText(validate.errors));
  });
}
