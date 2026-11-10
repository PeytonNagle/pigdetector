import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../lib/schemas.mjs';
import door from '../../../../fixtures/db/node.door.json' with { type: 'json' };

test('fills in v and leaves the input unchanged', () => {
  const { v, ...withoutVersion } = door;
  assert.equal(validate('db/node', withoutVersion).v, 1);
  assert.equal('v' in withoutVersion, false);
});

test('rejects bad nodes', async (t) => {
  // Each case names the rule it should break, so a case can't pass by failing for another reason.
  const cases = {
    'seconds instead of ms': [{ createdAt: 1762732800 }, /data\/createdAt must be >=/],
    'unknown version': [{ v: 2 }, /data\/v must be equal to constant/],
    'extra field': [{ color: 'red' }, /must NOT have additional properties/],
    'unknown kind': [{ kind: 'humidity' }, /data\/kind must be equal to one of/],
    'device ID with spaces': [{ deviceId: 'pd door' }, /data\/deviceId must match pattern/],
    'empty name': [{ name: '' }, /data\/name must NOT have fewer than 1/],
  };
  for (const [name, [change, message]] of Object.entries(cases)) {
    await t.test(name, () => assert.throws(() => validate('db/node', { ...door, ...change }), message));
  }
});

test('throws a clear error for an unknown schema name', () => {
  assert.throws(() => validate('db/nope', {}), /no schema named db\/nope/);
});
