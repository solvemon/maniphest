import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSim } from './index.ts';

test('should describe the current sim version', () => {
    assert.equal(describeSim(), 'sim 0.0.0');
});
