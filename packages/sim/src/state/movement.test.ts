import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce } from './reduce.ts';
import { initialState } from './state.ts';
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
