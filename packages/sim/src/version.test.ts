import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_VERSION } from './version.ts';

test('should expose the current sim version', () => {
    assert.equal(SIM_VERSION, '0.0.0');
});
