import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventRng } from './event.ts';
import type { RngState } from './rng.ts';

/**
 * Shared fixtures and helpers for `event.test.ts`. Kept at the top of the
 * file so later tasks can append more tests below and reuse them without
 * duplicating setup.
 */

const SEED = 12345;

/** Round-trips a snapshot through JSON, mirroring how a save file would. */
function roundTripState(state: RngState): RngState {
    return JSON.parse(JSON.stringify(state)) as RngState;
}

test('should resume mid-sequence from a JSON round-tripped snapshot and match an unbroken draw', () => {
    const continuous = eventRng({ seed: SEED, counter: 0 });
    const continuousValues: number[] = [];

    for (let i = 0; i < 10; i++) {
        continuousValues.push(continuous.float());
    }

    const first = eventRng({ seed: SEED, counter: 0 });
    const firstValues: number[] = [];

    for (let i = 0; i < 3; i++) {
        firstValues.push(first.float());
    }

    const resumedState = roundTripState(first.snapshot());
    const resumed = eventRng(resumedState);
    const resumedValues: number[] = [];

    for (let i = 0; i < 7; i++) {
        resumedValues.push(resumed.float());
    }

    assert.deepEqual([...firstValues, ...resumedValues], continuousValues);
});

test('should advance snapshot().counter by exactly one per draw, and leave it unchanged when snapshot() is called repeatedly', () => {
    const rng = eventRng({ seed: SEED, counter: 0 });

    assert.equal(rng.snapshot().counter, 0);
    assert.equal(rng.snapshot().counter, 0);
    assert.equal(rng.snapshot().counter, 0);

    for (let expected = 1; expected <= 5; expected++) {
        rng.float();
        assert.equal(rng.snapshot().counter, expected);
        assert.equal(rng.snapshot().counter, expected);
    }
});

test('should round-trip a snapshot through JSON with no loss', () => {
    const rng = eventRng({ seed: SEED, counter: 0 });

    rng.float();
    rng.float();
    rng.int(1, 100);

    const snap = rng.snapshot();

    assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
});

test('should preserve the original seed in snapshot()', () => {
    const rng = eventRng({ seed: SEED, counter: 42 });

    rng.float();

    assert.equal(rng.snapshot().seed, SEED);
});

test('should resume at a large counter and match a fresh stream sampled directly at that position', () => {
    // Draws are a pure function of (seed, counter), so a construction-only
    // check (e.g. comparing two `eventRng` instances at nearby counters)
    // would not actually prove that counter N lines up with the Nth draw
    // of an unbroken stream - it would only prove internal self-
    // consistency. This test proves genuine positional equivalence by
    // drawing 1,000,000+ values from a counter-0 stream and comparing them
    // against a stream resumed at counter 1_000_000. Measured locally at
    // ~255ms for 1,000,001 `float()` calls - well under a second - so the
    // direct loop is used instead of a state-construction shortcut.
    const LARGE_COUNTER = 1_000_000;
    const SAMPLE_SIZE = 5;

    const continuous = eventRng({ seed: SEED, counter: 0 });

    for (let i = 0; i < LARGE_COUNTER; i++) {
        continuous.float();
    }

    const continuousValues: number[] = [];

    for (let i = 0; i < SAMPLE_SIZE; i++) {
        continuousValues.push(continuous.float());
    }

    const resumed = eventRng({ seed: SEED, counter: LARGE_COUNTER });
    const resumedValues: number[] = [];

    for (let i = 0; i < SAMPLE_SIZE; i++) {
        resumedValues.push(resumed.float());
    }

    assert.deepEqual(resumedValues, continuousValues);
});

test('should throw RangeError for a negative counter', () => {
    assert.throws(() => eventRng({ seed: SEED, counter: -1 }), RangeError);
});

test('should throw RangeError for a fractional counter', () => {
    assert.throws(() => eventRng({ seed: SEED, counter: 0.5 }), RangeError);
});

test('should throw RangeError for a non-safe-integer seed', () => {
    assert.throws(() => eventRng({ seed: NaN, counter: 0 }), RangeError);
});

test('should yield identical continuations when a mid-stream snapshot is taken twice', () => {
    const rng = eventRng({ seed: SEED, counter: 0 });

    for (let i = 0; i < 4; i++) {
        rng.float();
    }

    const snapshotA = rng.snapshot();
    const resumedA = eventRng(snapshotA);
    const continuationA: number[] = [];

    for (let i = 0; i < 6; i++) {
        continuationA.push(resumedA.float());
    }

    const snapshotB = rng.snapshot();
    const resumedB = eventRng(snapshotB);
    const continuationB: number[] = [];

    for (let i = 0; i < 6; i++) {
        continuationB.push(resumedB.float());
    }

    assert.deepEqual(snapshotA, snapshotB);
    assert.deepEqual(continuationA, continuationB);
});

test('should produce a different value for a different seed at the same counter', () => {
    const a = eventRng({ seed: 1, counter: 7 }).float();
    const b = eventRng({ seed: 2, counter: 7 }).float();

    assert.notEqual(a, b);
});

test('should match a pinned first-8 float() sequence from counter 0', () => {
    // Hardcoded literal expectations, generated once by running the actual
    // implementation (not invented) and pinned here so the per-draw combine
    // in rng.ts cannot silently change while every other test in this file
    // - self-consistency between two constructions, or resume equivalence -
    // keeps passing regardless of what the mixing chain actually does.
    const expected = [
        0.6291932815332858,
        0.5548130632287196,
        0.6738713892167163,
        0.07158658866601908,
        0.14628353931939297,
        0.1867820028462176,
        0.522420732752433,
        0.42388148780440926,
    ];

    const rng = eventRng({ seed: SEED, counter: 0 });
    const actual: number[] = [];

    for (let i = 0; i < expected.length; i++) {
        actual.push(rng.float());
    }

    assert.deepEqual(actual, expected);
});

test('should match a pinned float() value resumed at counter 1,000,000', () => {
    // Locks the resume path itself: a change to the mixing chain that
    // happens to preserve every self-consistency and statistical property
    // exercised elsewhere in this file would still be caught here, because
    // this value is a literal pinned from the real implementation rather
    // than derived by comparing two constructions against each other.
    const resumed = eventRng({ seed: SEED, counter: 1_000_000 });

    assert.equal(resumed.float(), 0.05684885127884598);
});
