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
  const cases = {
    'seconds instead of ms': { createdAt: 1762732800 },
    'unknown version': { v: 2 },
    'extra field': { color: 'red' },
    'unknown kind': { kind: 'humidity' },
    'device ID with spaces': { deviceId: 'pd door' },
    'empty name': { name: '' },
  };
  for (const [name, change] of Object.entries(cases)) {
    await t.test(name, () => assert.throws(() => validate('db/node', { ...door, ...change }), /invalid db\/node/));
  }
});
