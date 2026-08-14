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

test('should reject UNDOCK with NOT_DOCKED when the ship is already in space', () => {
    const start = initialState(SEED);
    const undocked = reduce(start, { type: 'UNDOCK' });

    assertRejected(undocked, { type: 'UNDOCK' }, 'NOT_DOCKED');
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
