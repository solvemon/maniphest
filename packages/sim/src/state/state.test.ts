import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, STATE_VERSION } from './state.ts';
import { eventRng } from '../rng/index.ts';
import { HOME_SYSTEM_ID, systemById } from '../map/index.ts';
import { findUndefined } from './test-helpers.ts';

/**
 * Shared fixtures and helpers for `state.test.ts`. Kept at the top of the
 * file so later tests (initial-state shape, defaults, seed derivation) can
 * be appended below and reuse them without duplicating setup.
 *
 * `findUndefined` lives in `./test-helpers.ts` (a plain, non-`*.test.ts`
 * module) rather than here, since `reduce.test.ts` also needs it: importing
 * a helper from a sibling `*.test.ts` file would make Node's test runner
 * execute that sibling's `test()` registrations a second time as a side
 * effect of the import. See `test-helpers.ts` for the full rationale.
 */
const SEED = 424242;

test('should find no undefined paths in an object with only defined scalar and array values', () => {
    assert.deepEqual(findUndefined({ a: 1, b: [2, 3] }), []);
});

test("should find 'x.y' in a nested object whose leaf is undefined", () => {
    assert.deepEqual(findUndefined({ x: { y: undefined } }), ['x.y']);
});

test("should find 'arr[1]' in an object whose array contains an undefined element", () => {
    assert.deepEqual(findUndefined({ arr: [1, undefined] }), ['arr[1]']);
});

test('should report the empty path for a bare top-level undefined', () => {
    assert.deepEqual(findUndefined(undefined), ['']);
});

test('should find every undefined path when several are nested at different depths', () => {
    const value = {
        a: 1,
        b: { c: undefined, d: 2 },
        e: [undefined, { f: undefined }],
    };

    assert.deepEqual(findUndefined(value), ['b.c', 'e[0]', 'e[1].f']);
});

test('should round-trip initialState(SEED) through JSON', () => {
    const s = initialState(SEED);

    assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), s);
});

test('should find no undefined values in initialState(SEED)', () => {
    const paths = findUndefined(initialState(SEED));

    assert.deepStrictEqual(paths, [], `found undefined at: ${paths.join(', ')}`);
});

test('should produce deep-equal states with distinct cargo objects across calls with the same seed', () => {
    const a = initialState(SEED);
    const b = initialState(SEED);

    assert.deepStrictEqual(a, b);
    assert.notEqual(a.vessel.cargo, b.vessel.cargo);
});

test('should derive a different rng.seed from a different world seed, with rng.counter starting at 0', () => {
    const a = initialState(1);
    const b = initialState(2);

    assert.notEqual(a.rng.seed, b.rng.seed);
    assert.equal(a.rng.counter, 0);
    assert.equal(b.rng.counter, 0);
});

test('should derive an rng.seed that is a safe integer usable by eventRng without throwing', () => {
    const { rng } = initialState(SEED);

    assert.ok(Number.isSafeInteger(rng.seed));

    const value = eventRng(rng).float();

    assert.ok(value >= 0 && value < 1);
});

test('should throw RangeError for a non safe-integer world seed', () => {
    assert.throws(() => initialState(1.5), RangeError);
    assert.throws(() => initialState(NaN), RangeError);
    assert.throws(() => initialState(Infinity), RangeError);
});

test('should fix STATE_VERSION at 1', () => {
    assert.equal(STATE_VERSION, 1);
});

test('should tag initialState(SEED) with the current STATE_VERSION', () => {
    assert.equal(initialState(SEED).version, STATE_VERSION);
});

test('should populate initialState(SEED) with the Slice-0 placeholder values', () => {
    const s = initialState(SEED);

    assert.equal(s.vessel.fuel, 100);
    assert.equal(s.vessel.hull, 100);
    assert.equal(s.vessel.cargoCapacity, 50);
    assert.equal(s.credits, 1000);
    assert.deepEqual(s.player, { systemId: HOME_SYSTEM_ID, docked: true });
    assert.deepEqual(s.vessel.cargo, {});
    assert.equal(s.lastRejection, null);
    assert.equal(s.tick, 0);
    assert.equal(s.worldSeed, SEED);
});

test('should start docked at a system that exists in the map', () => {
    const s = initialState(SEED);

    assert.notEqual(systemById(s.player.systemId), null);
    assert.equal(s.player.docked, true);
});
