import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, ValidationError } from '../lib/schemas.mjs';
import door from '../../../../fixtures/db/node.door.json' with { type: 'json' };

test('fills in v and leaves the input unchanged', () => {
  const { v, ...withoutVersion } = door;
  const result = validate('node', withoutVersion);
  assert.equal(result.v, 1);
  assert.equal('v' in withoutVersion, false);
});

test('rejects bad nodes', async (t) => {
  const cases = {
    'seconds instead of ms': { ...door, createdAt: 1762732800 },
    'unknown version': { ...door, v: 2 },
    'extra field': { ...door, color: 'red' },
    'unknown kind': { ...door, kind: 'humidity' },
    'device ID with spaces': { ...door, deviceId: 'pd door' },
    'empty name': { ...door, name: '' },
  };
  for (const [name, item] of Object.entries(cases)) {
    await t.test(name, () => assert.throws(() => validate('node', item), ValidationError));
  }
});

test('throws on an entity with no schema', () => {
  assert.throws(() => validate('nope', {}), /no schema for nope/);
});
