import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from './reduce.ts';
import { initialState } from './state.ts';
import type { State } from './state.ts';
import type { RejectionReason } from './rejection.ts';
import { DOCKING_TICKS, JUMP_TICKS_PER_DISTANCE } from './movement.ts';
import { distanceBetween } from '../map/index.ts';

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
