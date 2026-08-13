import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from './rng.ts';

const DRAWS = 100_000;
const TOLERANCE = 0.02;

test('should distribute int(1, 3) roughly evenly across its three buckets', () => {
    const rng = makeRng(1n);
    const counts = new Map<number, number>([
        [1, 0],
        [2, 0],
        [3, 0],
    ]);

    for (let i = 0; i < DRAWS; i++) {
        const value = rng.int(1, 3);
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    for (const count of counts.values()) {
        const share = count / DRAWS;
        assert.ok(
            Math.abs(share - 1 / 3) <= TOLERANCE,
            `expected bucket share near 1/3, got ${share}`,
        );
    }
});

test('should return the single value when min equals max', () => {
    const rng = makeRng(2n);

    assert.equal(rng.int(5, 5), 5);
});

test('should throw RangeError for an inverted range', () => {
    const rng = makeRng(3n);

    assert.throws(() => rng.int(3, 1), RangeError);
});

test('should throw RangeError for a non-integer bound', () => {
    const rng = makeRng(4n);

    assert.throws(() => rng.int(1.5, 2), RangeError);
});

test('should always return false for chance(0)', () => {
    const rng = makeRng(5n);

    for (let i = 0; i < 1_000; i++) {
        assert.equal(rng.chance(0), false);
    }
});

test('should always return true for chance(1)', () => {
    const rng = makeRng(6n);

    for (let i = 0; i < 1_000; i++) {
        assert.equal(rng.chance(1), true);
    }
});

test('should return true roughly 30% of the time for chance(0.3)', () => {
    const rng = makeRng(7n);
    let trueCount = 0;

    for (let i = 0; i < DRAWS; i++) {
        if (rng.chance(0.3)) {
            trueCount++;
        }
    }

    const share = trueCount / DRAWS;
    assert.ok(Math.abs(share - 0.3) <= TOLERANCE, `expected chance share near 0.3, got ${share}`);
});

test('should throw RangeError when picking from an empty array', () => {
    const rng = makeRng(8n);

    assert.throws(() => rng.pick([]), RangeError);
});

test('should eventually pick every element of a 3-element array', () => {
    const rng = makeRng(9n);
    const items = ['a', 'b', 'c'];
    const seen = new Set<string>();

    for (let i = 0; i < 1_000; i++) {
        seen.add(rng.pick(items));
    }

    assert.deepEqual(seen, new Set(items));
});

test('should produce identical sequences for two instances sharing a base', () => {
    const rngA = makeRng(42n);
    const rngB = makeRng(42n);

    for (let i = 0; i < 1_000; i++) {
        assert.equal(rngA.float(), rngB.float());
    }
});

test('should advance the counter exactly once per float() call', () => {
    const rng = makeRng(10n);

    assert.equal(rng.counter(), 0);

    rng.float();
    assert.equal(rng.counter(), 1);

    rng.float();
    assert.equal(rng.counter(), 2);

    rng.float();
    assert.equal(rng.counter(), 3);
});
