/**
 * Home of the `JUMP`, `DOCK`, and `UNDOCK` action specs (M0-04) and the
 * tick-cost constants those specs are built from.
 *
 * The two-system map, its lane(s), and the posture rules governing docking
 * and undocking all live here rather than in `registry.ts`, so the registry
 * stays a pure lookup table (per its own doc comment) and this file stays
 * the single place movement-specific behavior can change.
 */

import type { DockAction, UndockAction } from './actions.ts';
import { defineAction } from './actions.ts';

/** `DOCK`/`UNDOCK` cost 1 tick each per DESIGN.md §3's action-duration table. */
export const DOCKING_TICKS = 1;

/** Ticks per unit distance for `JUMP`'s `ceil(distance / jumpSpeed)` cost in §3, at the default hull's jumpSpeed of 0.5. */
export const JUMP_TICKS_PER_DISTANCE = 2;

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
