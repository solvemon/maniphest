/**
 * Home of all rescue behavior (M0-06): the rescue constants, the
 * `nearestDepot` destination helper, and the `RESCUE` action spec.
 *
 * All of it lives here rather than in `registry.ts`, so the registry stays a
 * pure lookup table (per its own doc comment) and `reduce.ts` stays a pure
 * driver with no domain logic of its own — exactly as `fuel.ts` does for
 * M0-05's fuel actions and `movement.ts` does for M0-04's movement actions.
 *
 * `isStranded` (from `fuel.ts`) is the single authority on whether a `RESCUE`
 * is legal in the first place; this file never re-derives that answer, only
 * consumes it, so the two can never disagree about when a tow is warranted.
 */

import type { RescueAction } from './actions.ts';
import { defineAction } from './actions.ts';
import { distanceBetween, hasDepot, SYSTEMS } from '../map/index.ts';
import { fuelCostOf, isStranded } from './fuel.ts';
import { JUMP_TICKS_PER_DISTANCE } from './movement.ts';
import { reject } from './rejection.ts';
import type { State } from './state.ts';

/**
 * Fraction of the player's credits the tow takes as its fee.
 *
 * At `0.25`, a rescue is a felt setback without wiping out the player
 * outright. This is a placeholder value only, to be tuned by M0-12's balance
 * report once real playtesting data exists — see DESIGN.md §14's tracked
 * risk that a percentage haircut stings early and decays in severity as
 * wealth grows.
 */
export const RESCUE_CREDIT_SHARE = 0.25;

/**
 * Finds the id of the depot system nearest to the player's current system,
 * or `null` if none is reachable.
 *
 * This is the single authority on the tow's destination: `RESCUE`'s
 * `duration` and `apply` both consult it rather than re-deriving the answer,
 * so the two can never disagree about where the tow ends up — the same
 * pattern `fuelCostOf` establishes for jump cost in `fuel.ts`.
 *
 * Depot status is checked through the `hasDepot()` helper rather than
 * reading `System.hasDepot` directly, since M2-08 replaces that literal flag
 * with a hash-based derivation; going through the helper is what keeps that
 * swap from rippling out to this function.
 *
 * A `null` distance from `distanceBetween` — an unknown system id, or a known
 * system with no recorded lane to it — removes that system from
 * consideration rather than being treated as a zero-cost route: "no route"
 * is not a free route, the same stance `fuelCostOf` and `isStranded` take on
 * the same `null` in `fuel.ts`.
 *
 * Ties are resolved by `SYSTEMS`' array order — the first depot found at the
 * minimum distance wins, since a strict `<` comparison never displaces an
 * earlier candidate for an equal one — so the result is fully deterministic
 * for a given `state`, with no `eventRng` draw involved.
 */
export function nearestDepot(state: State): string | null {
  let nearestId: string | null = null;
  let nearestDistance = Infinity;

  for (const system of SYSTEMS) {
    if (!hasDepot(system.id)) {
      continue;
    }

    const distance = distanceBetween(state.player.systemId, system.id);
    if (distance === null) {
      continue;
    }

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = system.id;
    }
  }

  return nearestId;
}

export const rescueSpec = defineAction<RescueAction>({
  parse: () => ({ type: 'RESCUE' }),
  duration: (state) =>
    (distanceBetween(state.player.systemId, nearestDepot(state) ?? '') ?? 0) * JUMP_TICKS_PER_DISTANCE,
  apply: (state) => {
    if (!isStranded(state)) {
      return reject('NOT_STRANDED');
    }
    const destination = nearestDepot(state);
    if (destination === null) {
      return reject('NO_DEPOT');
    }

    const relocated = { ...state, player: { systemId: destination, docked: true } };
    const minJumpCost = SYSTEMS.filter((s) => s.id !== destination).reduce<number | null>((min, s) => {
      const cost = fuelCostOf(relocated, s.id);
      if (cost === null) {
        return min;
      }
      return min === null ? cost : Math.min(min, cost);
    }, null);
    const fuel =
      minJumpCost === null
        ? state.vessel.fuel
        : Math.min(state.vessel.fuelCapacity, Math.max(state.vessel.fuel, minJumpCost));

    return {
      ...state,
      player: { systemId: destination, docked: true },
      vessel: { ...state.vessel, cargo: {}, fuel },
      credits: Math.max(0, state.credits - Math.ceil(state.credits * RESCUE_CREDIT_SHARE)),
    };
  },
});
