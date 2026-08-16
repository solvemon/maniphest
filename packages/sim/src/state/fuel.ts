/**
 * Home of all fuel behavior (M0-05): the fuel constants, the `fuelCostOf`
 * calculation, the `REFUEL` action spec, and the `isStranded` selector.
 *
 * All of it lives here rather than in `registry.ts`, so the registry stays a
 * pure lookup table (per its own doc comment) and this file stays the single
 * place fuel-specific behavior can change — exactly as `movement.ts` does for
 * M0-04's movement actions. `reduce.ts` stays untouched.
 *
 * Keeping the cost formula in one place is what lets `jumpSpec.apply` and
 * `isStranded` never disagree about what a jump costs.
 */

import type { RefuelAction } from './actions.ts';
import { defineAction } from './actions.ts';
import { distanceBetween, hasDepot, SYSTEMS } from '../map/index.ts';
import { reject } from './rejection.ts';
import type { State } from './state.ts';

/**
 * Fuel burned per unit of map distance, before hull efficiency is applied.
 *
 * At `1`, the `sol`↔`vega` distance of 10 costs 10 fuel on a baseline
 * hull — a round, legible number for manually checking fuel math during
 * slice-0 development. This is a placeholder value only, to be tuned by
 * M0-12's balance report once real playtesting data exists.
 */
export const FUEL_PER_DISTANCE = 1;

/**
 * Credits charged per unit of fuel purchased at a depot.
 *
 * At `25`, a full 10-unit top-up costs 250 of the player's 1000 starting
 * credits, making refuelling a felt expense rather than a formality the
 * player never has to think about. This is a placeholder value only, to be
 * tuned by M0-12's balance report once real playtesting data exists.
 */
export const FUEL_PRICE_PER_UNIT = 25;

/** `REFUEL` costs 1 tick per DESIGN.md §3's action-duration table. */
export const REFUEL_TICKS = 1;

/**
 * Computes the fuel cost of jumping from the player's current system to
 * `systemId`.
 *
 * This is the single authority on what a jump costs: both `jumpSpec.apply`
 * and `isStranded` consult it, so the two can never disagree about what the
 * player can afford.
 *
 * Returns `null` if `distanceBetween` does — i.e. for an unknown system id,
 * or for a known system with no recorded lane to it. Callers turn that `null`
 * into a `NO_ROUTE` rejection rather than treating a missing route as
 * free or infinite travel.
 *
 * Otherwise this is DESIGN.md §8's cost formula,
 * `distance * fuelPerUnit / efficiency * hazardMultiplier`, minus the
 * `hazardMultiplier` term: that factor has no meaning until hazards land in
 * M2, so multiplying by an implicit `1` here would be dead weight rather
 * than a real placeholder.
 *
 * The result is rounded up to an integer via `Math.ceil`. Fractional fuel
 * would round-trip through JSON fine, but risks accumulating drift across
 * many jumps that M0-09's deep-equality replay check would surface as a
 * mysterious failure; integers keep `State`'s serialization-fidelity promise
 * cheap to hold onto.
 *
 * The current system yields `0` (distance to self is `0` per
 * `distanceBetween`), but this is not an escape route for `isStranded`: a
 * jump to the current system is never a legal action in the first place,
 * since `jumpSpec.apply` rejects it as `SAME_SYSTEM` before cost ever enters
 * the picture.
 */
export function fuelCostOf(state: State, systemId: string): number | null {
  const distance = distanceBetween(state.player.systemId, systemId);
  if (distance === null) {
    return null;
  }

  return Math.ceil((distance * FUEL_PER_DISTANCE) / state.vessel.fuelEfficiency);
}

/**
 * Buys `units` of fuel at the docked station.
 *
 * `requires: 'docked'` — a depot is a station service, so a `REFUEL`
 * attempted from open space is illegal before any argument or market check
 * runs. This is the first spec to actually emit `NOT_DOCKED`, the posture
 * reason M0-04 reserved with no caller of its own.
 *
 * `parse` rebuilds `{ type: 'REFUEL', units }` from scratch rather than
 * passing `raw` through, so no stray property on `raw` can ever reach state
 * — mirroring `jumpSpec.parse`'s idiom in `movement.ts`. It accepts only a
 * `units` that is `typeof 'number'` and `Number.isSafeInteger`, `>= 1`,
 * rejecting `INVALID_ARGUMENT` otherwise: `Number.isSafeInteger` also
 * excludes `NaN` and `Infinity`, which is what keeps `lastRejection.action`
 * JSON-safe per `rejectInto`'s contract in `reduce.ts` — a `NaN` would
 * serialize to `null` and corrupt the replay record.
 *
 * `apply` checks in order — location, then physics, then economics:
 * `NO_DEPOT` first, since a station that sells no fuel makes every later
 * check moot; `FUEL_CAPACITY_EXCEEDED` next, since there is no point
 * pricing a purchase that physically will not fit in the tank; and
 * `INSUFFICIENT_CREDITS` last, once the request is known to be both at a
 * valid depot and physically fillable. Each check is all-or-nothing: an
 * unaffordable or oversized request is refused whole, never partially
 * filled, matching the reject-don't-clamp rule this file's other checks
 * already follow — silently buying "as much as fits and affords" would hide
 * a failed intent from the caller instead of reporting it. Filling to
 * exactly `fuelCapacity` succeeds; only strictly exceeding it is
 * `FUEL_CAPACITY_EXCEEDED`.
 */
export const refuelSpec = defineAction<RefuelAction>({
  requires: 'docked',
  parse: (raw) => {
    const units = raw['units'];
    if (typeof units !== 'number' || !Number.isSafeInteger(units) || units < 1) {
      return reject('INVALID_ARGUMENT');
    }
    return { type: 'REFUEL', units };
  },
  duration: () => REFUEL_TICKS,
  apply: (state, action) => {
    if (!hasDepot(state.player.systemId)) {
      return reject('NO_DEPOT');
    }
    if (state.vessel.fuel + action.units > state.vessel.fuelCapacity) {
      return reject('FUEL_CAPACITY_EXCEEDED');
    }
    if (state.credits < action.units * FUEL_PRICE_PER_UNIT) {
      return reject('INSUFFICIENT_CREDITS');
    }
    return {
      ...state,
      vessel: { ...state.vessel, fuel: state.vessel.fuel + action.units },
      credits: state.credits - action.units * FUEL_PRICE_PER_UNIT,
    };
  },
});

/**
 * Reports whether the player is stranded: docked or not, out of fuel, and
 * with no reachable depot left to refuel at.
 *
 * `state.player.docked` never enters this check. DESIGN.md §8 defines
 * stranded as "docked or adrift with insufficient fuel for any legal jump,
 * and not at a depot" — posture is explicitly not part of the test, because
 * `UNDOCK` is always free and always legal, so a docked player can turn
 * themselves into an adrift one at will. If posture affected the answer, a
 * player one `UNDOCK` away from every jump remaining illegal would read as
 * "not stranded" purely for standing on the wrong side of a door they can
 * open for free; the underlying fuel problem is identical either way.
 *
 * The current system is deliberately excluded from the reachability scan,
 * even though `fuelCostOf` happily returns `0` for it: a jump to the system
 * the player is already in is never a legal action (`jumpSpec.apply` rejects
 * it as `SAME_SYSTEM` before cost is even computed), so counting it would
 * report every player as able to "escape" to where they already are stuck.
 *
 * A `null` cost — no recorded lane to that system — is likewise not an
 * escape: `fuelCostOf` returns `null` for unknown or unreachable systems
 * precisely so callers don't mistake "no route" for "free route," and this
 * selector honors that by requiring a non-null, affordable cost before a
 * system counts as reachable.
 *
 * Being at a depot short-circuits to `false` unconditionally, even when the
 * player cannot afford any fuel there: AC #3 defines the predicate as true
 * "exactly when no legal jump exists and the player is not at a depot," and
 * broke-at-a-depot is a solvent-but-poor problem, not a stuck-with-no-route
 * one — the player can still sell cargo, wait, or otherwise earn credits
 * without needing a rescue. Widening this selector to also catch that case
 * would exceed the stated contract and would hand M0-06's tow a case it
 * cannot actually resolve, since towing the player to the depot they are
 * already standing on changes nothing. Leaving the soft-lock out of
 * `isStranded` keeps M0-06's tow precondition clean (every tow it triggers
 * for genuinely relocates the player to fuel) and leaves the broke-at-a-depot
 * case visible, unmasked, for M0-12's balance report to measure on its own
 * terms.
 *
 * A pure selector with no state of its own, exported for M0-06's rescue
 * trigger, M0-11's harness, and M0-12's stranding-rate metric to consult.
 */
export function isStranded(state: State): boolean {
  if (hasDepot(state.player.systemId)) {
    return false;
  }

  const canReachAnotherSystem = SYSTEMS.some((system) => {
    if (system.id === state.player.systemId) {
      return false;
    }

    const cost = fuelCostOf(state, system.id);
    return cost !== null && cost <= state.vessel.fuel;
  });

  return !canReachAnotherSystem;
}
