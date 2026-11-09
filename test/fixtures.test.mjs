// Checks the shared contracts in fixtures/: every schema compiles, and every example matches its schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const SCHEMAS = join(FIXTURES, 'schemas');
const ID_BASE = 'https://schemas.pigdetector.invalid/';

function jsonFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(dir, f));
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const toPosix = (p) => p.split(sep).join('/');

const schemaFiles = jsonFiles(SCHEMAS);
const exampleFiles = jsonFiles(FIXTURES).filter((f) => !f.startsWith(SCHEMAS + sep));

// No useDefaults here: examples must spell out every field, since other teams copy them.
const ajv = new Ajv({ allErrors: true, schemas: schemaFiles.map(readJson) });

// fixtures/db/node.door.json -> schemas/db/node.schema.json
function schemaIdFor(exampleFile) {
  const rel = toPosix(relative(FIXTURES, exampleFile));
  const name = basename(rel).split('.')[0];
  const dir = dirname(rel);
  return `${ID_BASE}${dir === '.' ? '' : dir + '/'}${name}.schema.json`;
}

for (const file of schemaFiles) {
  const rel = toPosix(relative(SCHEMAS, file));

  test(`schema ${rel}: $id matches its path and it compiles`, () => {
    assert.equal(readJson(file).$id, ID_BASE + rel);
    assert.ok(ajv.getSchema(ID_BASE + rel), 'compiles');
  });

  // Top-level files hold shared $defs only; schemas in subfolders describe real data.
  if (rel.includes('/')) {
    test(`schema ${rel}: has at least one example`, () => {
      assert.ok(exampleFiles.some((f) => schemaIdFor(f) === ID_BASE + rel), 'no example points to this schema');
    });
  }
}

for (const file of exampleFiles) {
  const rel = toPosix(relative(FIXTURES, file));
  test(`example ${rel} matches its schema`, () => {
    const validate = ajv.getSchema(schemaIdFor(file));
    assert.ok(validate, `no schema at ${schemaIdFor(file)}`);
    assert.ok(validate(readJson(file)), ajv.errorsText(validate.errors));
  });
}
