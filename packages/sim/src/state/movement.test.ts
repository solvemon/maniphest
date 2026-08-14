import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, durationOf } from './reduce.ts';
import { initialState } from './state.ts';
import type { State } from './state.ts';
import type { RejectionReason } from './rejection.ts';
import { DOCKING_TICKS, JUMP_TICKS_PER_DISTANCE } from './movement.ts';
import { distanceBetween } from '../map/index.ts';
import { ACTIONS } from './registry.ts';
import { defineAction } from './actions.ts';
import { reject } from './rejection.ts';
import { findUndefined } from './test-helpers.ts';

/**
 * Shared fixtures and helpers for `movement.test.ts`. Kept at the top of the
 * file so later tasks (rejection paths, posture-gate coverage, and beyond)
 * can append below and reuse them without duplicating setup.
 */
const SEED = 909090;

/** Ticks a `JUMP` from `'sol'` to `'vega'` costs: distance 10 * 2 ticks/unit = 20. */
const SOL_TO_VEGA_JUMP_TICKS = (distanceBetween('sol', 'vega') ?? 0) * JUMP_TICKS_PER_DISTANCE;

/**
 * Asserts that `reduce(prev, action)` takes the rejection path with
 * `expected` as the reason, and that the result satisfies every invariant
 * `reduce`'s rejection branch promises:
 *
 * - a fresh object is returned (`next !== prev`), never the identical
 *   reference the "ignored" path (unknown type / malformed shape) returns.
 * - `tick` is left untouched — a rejection never advances the clock.
 * - `lastRejection.reason` is `expected`.
 * - `lastRejection.action` deep-equals `action` exactly as passed in here
 *   (verbatim, not re-derived), since for the zero-argument `DOCK`/`UNDOCK`
 *   specs `parse` rebuilds `{ type }` from nothing and so round-trips any
 *   extra-property-free action unchanged.
 * - nothing else differs between `prev` and `next`: comparing both
 *   serialized with `lastRejection` nulled out on each side catches any
 *   stray field the rejection path might have touched, without the
 *   comparison being defeated by the two (necessarily different)
 *   `lastRejection` values themselves.
 */
function assertRejected(prev: State, action: unknown, expected: RejectionReason): void {
    const next = reduce(prev, action);

    assert.notEqual(next, prev);
    assert.equal(next.tick, prev.tick);
    assert.equal(next.lastRejection?.reason, expected);
    assert.deepStrictEqual(next.lastRejection?.action, action);
    assert.equal(
        JSON.stringify({ ...next, lastRejection: null }),
        JSON.stringify({ ...prev, lastRejection: null }),
    );
}

/**
 * Asserts that `reduce(prev, action)` rejects `action` with `expected`
 * because `action` fails a spec's `parse` outright — e.g. a `JUMP` whose
 * `systemId` is not a valid non-empty string.
 *
 * Deliberately not {@link assertRejected}: `reduce`'s `rejectInto` call for
 * a parse-stage rejection stores only `{ type: action.type }` in
 * `lastRejection.action` (see `reduce.ts`), discarding whatever malformed
 * value `action` carried — a value that failed `parse` may not even be
 * JSON-safe (`NaN`, `undefined`, a cyclic reference, ...), so it must never
 * reach `lastRejection` verbatim. `assertRejected` checks the recorded
 * action against `action` itself, which only holds for a spec whose
 * `parse` succeeded; this variant checks it against that trimmed
 * `{ type: action.type }` shape instead, and is otherwise identical.
 */
function assertRejectedMalformed(
    prev: State,
    action: Record<string, unknown>,
    expected: RejectionReason,
): void {
    const next = reduce(prev, action);

    assert.notEqual(next, prev);
    assert.equal(next.tick, prev.tick);
    assert.equal(next.lastRejection?.reason, expected);
    assert.deepStrictEqual(next.lastRejection?.action, { type: action['type'] });
    assert.equal(
        JSON.stringify({ ...next, lastRejection: null }),
        JSON.stringify({ ...prev, lastRejection: null }),
    );
}

test('should reject UNDOCK with NOT_DOCKED when the ship is already in space', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejected(undocked, { type: 'UNDOCK' }, 'NOT_DOCKED');
});

test('should reject JUMP with SAME_SYSTEM when the destination is the current system', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejected(undocked, { type: 'JUMP', systemId: undocked.player.systemId }, 'SAME_SYSTEM');
});

test('should reject JUMP with UNKNOWN_SYSTEM when the destination id is not in the map', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejected(undocked, { type: 'JUMP', systemId: 'nonexistent' }, 'UNKNOWN_SYSTEM');
});

test('should reject JUMP with NOT_IN_SPACE when the ship is docked', () => {
    const start = initialState(SEED);

    assertRejected(start, { type: 'JUMP', systemId: 'vega' }, 'NOT_IN_SPACE');
});

test('should reject DOCK with NOT_IN_SPACE when the ship is already docked', () => {
    const start = initialState(SEED);

    assertRejected(start, { type: 'DOCK' }, 'NOT_IN_SPACE');
});

test('should reject JUMP with INVALID_ARGUMENT when systemId is missing', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejectedMalformed(undocked, { type: 'JUMP' }, 'INVALID_ARGUMENT');
});

test('should reject JUMP with INVALID_ARGUMENT when systemId is not a string (42)', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejectedMalformed(undocked, { type: 'JUMP', systemId: 42 }, 'INVALID_ARGUMENT');
});

test('should reject JUMP with INVALID_ARGUMENT when systemId is null', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejectedMalformed(undocked, { type: 'JUMP', systemId: null }, 'INVALID_ARGUMENT');
});

test('should reject JUMP with INVALID_ARGUMENT when systemId is an empty string', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejectedMalformed(undocked, { type: 'JUMP', systemId: '' }, 'INVALID_ARGUMENT');
});

test('should reject JUMP with NOT_IN_SPACE for an unknown destination while docked (gate precedes apply)', () => {
    const start = initialState(SEED);

    assertRejected(start, { type: 'JUMP', systemId: 'nonexistent' }, 'NOT_IN_SPACE');
});

test('should reject JUMP with INVALID_ARGUMENT for a malformed systemId (42) while docked (parse precedes gate)', () => {
    const start = initialState(SEED);

    assertRejectedMalformed(start, { type: 'JUMP', systemId: 42 }, 'INVALID_ARGUMENT');
});

test('should run the happy movement loop UNDOCK -> JUMP vega -> DOCK from initialState(SEED)', () => {
    const start = initialState(SEED);

    const undocked = reduce(start, { type: 'UNDOCK' });

    assert.equal(undocked.tick, 1);
    assert.deepEqual(undocked.player, { systemId: 'sol', docked: false });
    assert.equal(undocked.lastRejection, null);

    const jumped = reduce(undocked, { type: 'JUMP', systemId: 'vega' });

    assert.equal(jumped.tick, 1 + SOL_TO_VEGA_JUMP_TICKS);
    assert.equal(jumped.tick, 21);
    assert.deepEqual(jumped.player, { systemId: 'vega', docked: false });
    assert.equal(jumped.lastRejection, null);

    const docked = reduce(jumped, { type: 'DOCK' });

    assert.equal(docked.tick, 22);
    assert.deepEqual(docked.player, { systemId: 'vega', docked: true });
    assert.equal(docked.lastRejection, null);
});

test('should leave the ship in space at the destination after a jump', () => {
    const start = initialState(SEED);

    const undocked = reduce(start, { type: 'UNDOCK' });

    const jumped = reduce(undocked, { type: 'JUMP', systemId: 'vega' });

    assert.equal(jumped.player.systemId, 'vega');
    assert.equal(jumped.player.docked, false);
});

test('should derive each action\'s tick delta from the map/movement constants, not a hardcoded number', () => {
    const start = initialState(SEED);

    const undocked = reduce(start, { type: 'UNDOCK' });

    assert.equal(undocked.tick - start.tick, DOCKING_TICKS);

    const jumped = reduce(undocked, { type: 'JUMP', systemId: 'vega' });
    const expectedJumpTicks = (distanceBetween('sol', 'vega') ?? 0) * JUMP_TICKS_PER_DISTANCE;

    assert.equal(jumped.tick - undocked.tick, expectedJumpTicks);

    const docked = reduce(jumped, { type: 'DOCK' });

    assert.equal(docked.tick - jumped.tick, DOCKING_TICKS);
});

test('should reject a docked-only action with NOT_DOCKED when undocked (M0-07 gate proof)', () => {
    // `reduce`'s posture gate (reduce.ts) rejects ANY spec declaring
    // `requires: 'docked'` while `state.player.docked` is false - it does not
    // special-case movement. M0-07 (BUY/SELL) is the first real consumer of
    // that branch, but M0-07 hasn't landed yet, so this test proves the gate
    // itself works by registering a throwaway spec that only exists to carry
    // `requires: 'docked'`.
    //
    // `ACTIONS` (registry.ts) is declared `export const` but is a plain,
    // unfrozen `Record<string, ActionSpec>` built once via
    // `Object.assign(Object.create(null), {...})` - there is no
    // `Object.freeze`, so assigning a new key on it here is a real mutation
    // of the exact object `reduce` looks up through, not a copy. No cast is
    // needed for the assignment itself (`ACTIONS` is already typed
    // `Record<string, ActionSpec>`, so a fresh string key is legal by that
    // type alone); the one cast below is `parse`'s return type, needed only
    // because `defineAction`'s generic parameter can't be inferred from an
    // arrow function whose branches return two unrelated shapes (the parsed
    // action vs. `Rejection`) without an explicit type argument.
    //
    // Registered under a type string no production code will ever emit
    // (`'__TEST_DOCKED_ONLY__'`), and removed in `finally` so no other test
    // in this file - or a run in a different order - can observe it.
    const TEST_TYPE = '__TEST_DOCKED_ONLY__';
    interface TestDockedOnlyAction {
        type: typeof TEST_TYPE;
    }

    ACTIONS[TEST_TYPE] = defineAction<TestDockedOnlyAction>({
        parse: (raw) => (raw.type === TEST_TYPE ? { type: TEST_TYPE } : reject('INVALID_ARGUMENT')),
        duration: () => 0,
        apply: (state) => state,
        requires: 'docked',
    });

    try {
        const start = initialState(SEED);
        const undocked = reduce(start, { type: 'UNDOCK' });

        assertRejected(undocked, { type: TEST_TYPE }, 'NOT_DOCKED');
    } finally {
        delete ACTIONS[TEST_TYPE];
    }
});

test('should preview a legal JUMP from sol to vega as SOL_TO_VEGA_JUMP_TICKS (20)', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assert.equal(durationOf(undocked, { type: 'JUMP', systemId: 'vega' }), SOL_TO_VEGA_JUMP_TICKS);
    assert.equal(durationOf(undocked, { type: 'JUMP', systemId: 'vega' }), 20);
});

test('should preview JUMP as null while docked (posture gate mirrored from reduce)', () => {
    const start = initialState(SEED);

    assert.equal(durationOf(start, { type: 'JUMP', systemId: 'vega' }), null);
});

test('should preview DOCK and UNDOCK as DOCKING_TICKS from their respective legal postures', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assert.equal(durationOf(undocked, { type: 'DOCK' }), DOCKING_TICKS);
    assert.equal(durationOf(start, { type: 'UNDOCK' }), DOCKING_TICKS);
});

test('should preview a malformed JUMP (non-string systemId) as null', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assert.equal(durationOf(undocked, { type: 'JUMP', systemId: 42 }), null);
});

test('should strip a stray property from an accepted DOCK action before it reaches state', () => {
    // `DOCK`'s `parse` rebuilds `{ type: 'DOCK' }` from scratch (a
    // zero-argument spec), so an accepted action carrying an extra property
    // must be normalized away rather than merged into `next` verbatim. This
    // is the accepted-path counterpart to `assertRejected`'s verbatim-action
    // note above: here the action is legal, so `next` must show no trace of
    // `sneaky` anywhere - not just in `lastRejection.action`, but nowhere in
    // the resulting state at all.
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    const docked = reduce(undocked, { type: 'DOCK', sneaky: 'x' });

    assert.equal(docked.tick, undocked.tick + DOCKING_TICKS);
    assert.equal(docked.player.docked, true);
    assert.equal(docked.lastRejection, null);
    assert.ok(!JSON.stringify(docked).includes('sneaky'));
});

/**
 * Recursively freezes `value` in place: every plain object and array
 * reachable from it (including `value` itself) is frozen with
 * `Object.freeze`, so a later attempt to mutate it throws instead of
 * silently succeeding or silently no-oping.
 *
 * Duplicated from `reduce.test.ts` rather than imported: a helper shared
 * across multiple test files must live in a non-`*.test.ts` module (see
 * `test-helpers.ts`'s doc comment) to avoid Node's test runner re-executing
 * the source file's `test()` registrations as a side effect of the import,
 * and `deepFreeze` isn't needed anywhere outside these two test files, so it
 * isn't worth promoting to `test-helpers.ts` for that alone.
 *
 * Used by the tests below to prove that `reduce` never mutates the `state`
 * it is given for the movement actions introduced in this issue (`UNDOCK`,
 * `JUMP`, `DOCK`) — passing a deep-frozen state in means any in-place write
 * inside `reduce` or a movement handler throws immediately rather than
 * passing unnoticed.
 */
function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        Object.freeze(value);
        return value;
    }
    if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
        return value;
    }
    return value;
}

/**
 * Asserts that `next` — the result of an accepted or rejected movement
 * action — round-trips through `JSON.parse(JSON.stringify(...))` with no
 * loss and contains no `undefined` anywhere in its shape, per the `State`
 * invariants documented in `state.ts` (no optional fields, JSON-round-trips
 * unchanged). `findUndefined` is reused from `test-helpers.ts` (M0-03)
 * rather than reimplemented here.
 */
function assertPureAndSerializable(next: State): void {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(next)), next);
    assert.deepStrictEqual(findUndefined(next), []);
}

test('should round-trip an accepted UNDOCK through JSON with no undefined fields, and never mutate or throw on a frozen input', () => {
    const start = deepFreeze(initialState(SEED));
    const before = JSON.stringify(start);

    assert.doesNotThrow(() => reduce(start, { type: 'UNDOCK' }));
    assert.equal(JSON.stringify(start), before);

    const undocked = reduce(start, { type: 'UNDOCK' });
    assertPureAndSerializable(undocked);
});

test('should round-trip an accepted JUMP through JSON with no undefined fields, and never mutate or throw on a frozen input', () => {
    const start = initialState(SEED);
    const undocked = deepFreeze(reduce(start, { type: 'UNDOCK' }));
    const before = JSON.stringify(undocked);

    assert.doesNotThrow(() => reduce(undocked, { type: 'JUMP', systemId: 'vega' }));
    assert.equal(JSON.stringify(undocked), before);

    const jumped = reduce(undocked, { type: 'JUMP', systemId: 'vega' });
    assertPureAndSerializable(jumped);
});

test('should round-trip an accepted DOCK through JSON with no undefined fields, and never mutate or throw on a frozen input', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });
    const jumped = deepFreeze(reduce(undocked, { type: 'JUMP', systemId: 'vega' }));
    const before = JSON.stringify(jumped);

    assert.doesNotThrow(() => reduce(jumped, { type: 'DOCK' }));
    assert.equal(JSON.stringify(jumped), before);

    const docked = reduce(jumped, { type: 'DOCK' });
    assertPureAndSerializable(docked);
});

/**
 * One rejection case per posture/system-map/argument reason this issue can
 * produce, each paired with the (deep-frozen) state its action is rejected
 * from:
 *
 * - `NOT_DOCKED` — `UNDOCK` while already in space.
 * - `NOT_IN_SPACE` — `DOCK` while already docked.
 * - `SAME_SYSTEM` — `JUMP` to the system the ship is already in.
 * - `UNKNOWN_SYSTEM` — `JUMP` to a destination id absent from the map.
 * - `INVALID_ARGUMENT` — `JUMP` with a malformed `systemId`.
 *
 * Both `start` and `undocked` are frozen once here and shared by every case
 * below: `reduce` never mutates its input (that is exactly what these tests
 * prove), so a case built from one of these fixtures observing the other's
 * rejection has nothing to worry about.
 */
function rejectionCases(): Array<{ reason: RejectionReason; prev: State; action: unknown }> {
    const start = deepFreeze(initialState(SEED));
    const undocked = deepFreeze(reduce(start, { type: 'UNDOCK' }));

    return [
        { reason: 'NOT_DOCKED', prev: undocked, action: { type: 'UNDOCK' } },
        { reason: 'NOT_IN_SPACE', prev: start, action: { type: 'DOCK' } },
        {
            reason: 'SAME_SYSTEM',
            prev: undocked,
            action: { type: 'JUMP', systemId: undocked.player.systemId },
        },
        {
            reason: 'UNKNOWN_SYSTEM',
            prev: undocked,
            action: { type: 'JUMP', systemId: 'nonexistent' },
        },
        {
            reason: 'INVALID_ARGUMENT',
            prev: undocked,
            action: { type: 'JUMP', systemId: 42 },
        },
    ];
}

for (const { reason, prev, action } of rejectionCases()) {
    test(`should round-trip a ${reason} rejection through JSON with no undefined fields, and never mutate or throw on a frozen input`, () => {
        const before = JSON.stringify(prev);

        assert.doesNotThrow(() => reduce(prev, action));
        assert.equal(JSON.stringify(prev), before);

        const rejected = reduce(prev, action);
        assert.equal(rejected.lastRejection?.reason, reason);
        assertPureAndSerializable(rejected);
    });
}
