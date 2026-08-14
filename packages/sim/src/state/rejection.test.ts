import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reject, isRejection } from './rejection.ts';

test('should build a Rejection with rejected true and the given reason', () => {
    assert.deepEqual(reject('INVALID_ARGUMENT'), { rejected: true, reason: 'INVALID_ARGUMENT' });
});

test('should recognize a value built by reject() as a Rejection', () => {
    assert.equal(isRejection(reject('INVALID_ARGUMENT')), true);
});

/**
 * `isRejection` must reject every one of these non-Rejection shapes,
 * including values that are almost right (`{ rejected: false }`,
 * `{ rejected: 'true' }`) and a plausible `State`-shaped object. `State`
 * itself does not exist yet, so the latter is an inline literal standing in
 * for it - the point is that a real state slice must never be mistaken for
 * a rejection sentinel just because it happens to be a non-null object.
 */
const NON_REJECTION_VALUES: unknown[] = [
    null,
    undefined,
    42,
    'x',
    [],
    {},
    { rejected: false },
    { rejected: 'true' },
    { version: 1, tick: 0, credits: 1000, lastRejection: null },
];

for (const value of NON_REJECTION_VALUES) {
    test(`should not recognize ${JSON.stringify(value)} as a Rejection`, () => {
        assert.equal(isRejection(value), false);
    });
}
