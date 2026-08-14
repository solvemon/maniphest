/**
 * Home of the `JUMP`, `DOCK`, and `UNDOCK` action specs (M0-04) and the
 * tick-cost constants those specs are built from.
 *
 * The two-system map, its lane(s), and the posture rules governing docking
 * and undocking all live here rather than in `registry.ts`, so the registry
 * stays a pure lookup table (per its own doc comment) and this file stays
 * the single place movement-specific behavior can change.
 */

import type { DockAction, JumpAction, UndockAction } from './actions.ts';
import { defineAction } from './actions.ts';
import { distanceBetween, systemById } from '../map/index.ts';
import { reject } from './rejection.ts';

/** `DOCK`/`UNDOCK` cost 1 tick each per DESIGN.md §3's action-duration table. */
export const DOCKING_TICKS = 1;

/** Ticks per unit distance for `JUMP`'s `ceil(distance / jumpSpeed)` cost in §3, at the default hull's jumpSpeed of 0.5. */
export const JUMP_TICKS_PER_DISTANCE = 2;

/**
 * Jumps the ship from its current system to `systemId`, leaving it undocked
 * in the destination system.
 *
 * `parse` accepts only a non-empty `string` `systemId`, rejecting
 * `INVALID_ARGUMENT` otherwise, and rebuilds `{ type: 'JUMP', systemId }`
 * from scratch so no stray property on `raw` can ever reach state.
 *
 * `apply` checks `UNKNOWN_SYSTEM` before `SAME_SYSTEM`: an unrecognized
 * destination id is a malformed argument that was never a valid target in
 * the first place, so it must be caught before asking whether that id
 * happens to match the current system — checking the reverse order would
 * let an unknown id that coincidentally equals the current system id report
 * the misleading `SAME_SYSTEM` instead of `UNKNOWN_SYSTEM`.
 */
export const jumpSpec = defineAction<JumpAction>({
  requires: 'inSpace',
  parse: (raw) => {
    const systemId = raw['systemId'];
    if (typeof systemId !== 'string' || systemId.length === 0) {
      return reject('INVALID_ARGUMENT');
    }
    return { type: 'JUMP', systemId };
  },
  duration: (state, action) =>
    (distanceBetween(state.player.systemId, action.systemId) ?? 0) * JUMP_TICKS_PER_DISTANCE,
  apply: (state, action) => {
    if (systemById(action.systemId) === null) {
      return reject('UNKNOWN_SYSTEM');
    }
    if (action.systemId === state.player.systemId) {
      return reject('SAME_SYSTEM');
    }
    return { ...state, player: { systemId: action.systemId, docked: false } };
  },
});

/**
 * Docks the ship at its current station, leaving open space.
 *
 * `parse` ignores `raw` entirely and rebuilds `{ type: 'DOCK' }` from
 * nothing, so no stray property on `raw` can ever reach state.
 */
export const dockSpec = defineAction<DockAction>({
  requires: 'inSpace',
  parse: () => ({ type: 'DOCK' }),
  duration: () => DOCKING_TICKS,
  apply: (state) => ({ ...state, player: { ...state.player, docked: true } }),
});

/**
 * Undocks the ship from its station, returning it to open space.
 *
 * `parse` ignores `raw` entirely and rebuilds `{ type: 'UNDOCK' }` from
 * nothing, so no stray property on `raw` can ever reach state.
 */
export const undockSpec = defineAction<UndockAction>({
  requires: 'docked',
  parse: () => ({ type: 'UNDOCK' }),
  duration: () => DOCKING_TICKS,
  apply: (state) => ({ ...state, player: { ...state.player, docked: false } }),
});
