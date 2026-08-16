/**
 * Home of the `JUMP`, `DOCK`, and `UNDOCK` action specs (M0-04) and the
 * tick-cost constants those specs are built from.
 *
 * The two-system map, its lane(s), and the posture rules governing docking
 * and undocking all live here rather than in `registry.ts`, so the registry
 * stays a pure lookup table (per its own doc comment) and this file stays
 * the single place movement-specific behavior can change.
 *
 * Invariant: each spec's `requires` field ('inSpace' or 'docked') is the
 * only place posture legality is expressed. No `parse`, `duration`, or
 * `apply` body below may read `state.player.docked` — that check belongs
 * solely to `requires`, which the driver enforces before the handler ever
 * runs. Reading `state.player.systemId` (the ship's position, not its
 * posture) is unrelated to this invariant and remains fine, as `jumpSpec`'s
 * `duration` does.
 *
 * The fuel cost formula itself lives in `fuel.ts`, not here: `jumpSpec.apply`
 * only consumes it by calling `fuelCostOf` and never computes a cost of its
 * own. That keeps the formula with exactly one home, so `jumpSpec` can never
 * drift out of agreement with `isStranded` about what a jump costs.
 */

import type { DockAction, JumpAction, UndockAction } from './actions.ts';
import { defineAction } from './actions.ts';
import { distanceBetween, systemById } from '../map/index.ts';
import { fuelCostOf } from './fuel.ts';
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
 * `apply` checks, in order, `UNKNOWN_SYSTEM` → `SAME_SYSTEM` → `NO_ROUTE` →
 * `INSUFFICIENT_FUEL`: identity and existence of the destination are
 * established before its resource cost is even considered. `UNKNOWN_SYSTEM`
 * before `SAME_SYSTEM` stays first for the reason already noted above — an
 * unrecognized destination id is a malformed argument that was never a valid
 * target in the first place, so it must be caught before asking whether that
 * id happens to match the current system, or an unknown id that coincidentally
 * equals the current system id would report the misleading `SAME_SYSTEM`
 * instead of `UNKNOWN_SYSTEM`. Both of those stay ahead of `NO_ROUTE` and
 * `INSUFFICIENT_FUEL` because they are cheaper and more fundamental: a
 * resource shortfall is only a meaningful thing to report about a
 * destination that is real and reachable in the first place. Concretely, a
 * zero-fuel ship jumping to its own system reports `SAME_SYSTEM`, not a fuel
 * complaint.
 *
 * `fuel === cost` is legal: the `<` comparison against `cost` lets a jump
 * that drains the tank to exactly zero through rather than rejecting it, and
 * that is deliberate rather than an off-by-one — it is precisely the path
 * that makes stranding (arriving with no fuel to leave again) reachable from
 * legal play, not a bug to be fenced off.
 *
 * An insufficient-fuel jump is rejected whole, never partially applied: there
 * is no clamping to "as far as the remaining fuel allows," only the binary
 * `INSUFFICIENT_FUEL` rejection above, leaving `state` untouched.
 *
 * `duration` does not account for `INSUFFICIENT_FUEL` (or any other `apply`-time
 * rejection): an unaffordable jump still previews the tick cost it would take
 * if it *could* be applied, rather than `null`. This mirrors `reduce.ts`'s
 * `durationOf`, which deliberately does not mirror a handler's semantic
 * `apply` rejections into the preview path — doing so would duplicate each
 * handler's `apply` logic inside `durationOf`, and `reduce` must remain the
 * sole authority on legality.
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
    const cost = fuelCostOf(state, action.systemId);
    if (cost === null) {
      return reject('NO_ROUTE');
    }
    if (state.vessel.fuel < cost) {
      return reject('INSUFFICIENT_FUEL');
    }
    return {
      ...state,
      player: { systemId: action.systemId, docked: false },
      vessel: { ...state.vessel, fuel: state.vessel.fuel - cost },
    };
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
