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

/**
 * Tows a stranded player to the nearest depot, forfeiting all cargo and a
 * percentage of credits. Hull damage persists. The run continues.
 *
 * No `requires`. `isStranded` (see `fuel.ts`) is deliberately posture-blind —
 * "docked or adrift" per DESIGN.md §8, since `UNDOCK` is always free and
 * legal, so posture is never a real barrier to the underlying fuel problem.
 * A `requires: 'inSpace'` or `requires: 'docked'` here would silently exclude
 * whichever posture it didn't name, contradicting the very selector this spec
 * exists to answer for. `RESCUE` must be callable from either posture, so it
 * enforces no posture at all and leaves stranding itself as the only gate.
 *
 * `apply` checks precondition before destination: `NOT_STRANDED` first,
 * `NO_DEPOT` second. A player who is not stranded has no rescue to grant in
 * the first place, so the question "where would the tow go" never needs
 * asking — the same cheapest-check-first ordering `refuelSpec` uses for
 * `NO_DEPOT` before `FUEL_CAPACITY_EXCEEDED` before `INSUFFICIENT_CREDITS` in
 * `fuel.ts`.
 *
 * `vessel.cargo` is reset with a fresh `{}` literal on every `apply` call,
 * never a shared module-level constant — the same aliasing rule
 * `initialState` documents in `state.ts`: two rescues (or a rescue and a
 * fresh run) must never end up with `Vessel.cargo` objects that are the same
 * reference, or a mutation via one player's state would silently leak into
 * the other's.
 *
 * Hull is carried through untouched: `{ ...state.vessel, cargo: {}, fuel }`
 * spreads `state.vessel` first, so `hull` passes through by construction
 * with no line here ever naming it. This is AC #4, and it is the mechanism
 * behind DESIGN.md §8's "the real cost of a bad run is a forced journey home,
 * not a number on a ledger" — a tow fixes the player's fuel and position, not
 * the damage that got them stranded, so hull repair remains a separate,
 * deliberate spend at a core system.
 *
 * The fuel grant (AC #3, "enough fuel for at least one jump") is derived from
 * `SYSTEMS`/`fuelCostOf` at call time rather than hard-coded as a constant,
 * so it can never drift out of step with the map: if M2 changes distances or
 * adds systems, `minJumpCost` recomputes against the new geometry
 * automatically instead of leaving a stale number here for someone to
 * remember to update. `Math.max(state.vessel.fuel, minJumpCost)` is a floor,
 * not an assignment — a tow tops the tank up to "enough to leave again" but
 * never drains fuel the player already had more of, since a rescue is a
 * bailout, not an additional penalty on top of the credit and cargo cost.
 * `Math.min(state.vessel.fuelCapacity, ...)` then caps that floor at the
 * tank's own ceiling, the same "never exceed capacity" stance `refuelSpec`
 * enforces for a purchased top-up.
 *
 * The credit deduction rounds with `Math.ceil`, not `Math.round` or
 * `Math.floor`: rounding the *deduction* up is what keeps the fee from ever
 * favoring the player at fractional-credit boundaries, mirroring
 * `fuelCostOf`'s "round the cost up, never down" stance in `fuel.ts`.
 * `Math.max(0, ...)` around the whole subtraction is AC #2's floor, spelled
 * out explicitly rather than left implicit: without it, a player with fewer
 * credits than `RESCUE_CREDIT_SHARE` would cost would end up with a negative
 * balance, which nothing else in `State` guards against.
 *
 * The tow ends **docked** (`player: { systemId: destination, docked: true }`)
 * rather than adrift in the depot system: arriving docked lets the player
 * `REFUEL` or trade immediately on the very next action, with no forced
 * `DOCK` tick standing between "just got rescued" and "can recover." Every
 * legal jump lands undocked (`jumpSpec` in `movement.ts`); a rescue is
 * deliberately not a jump.
 *
 * `duration` reuses `JUMP_TICKS_PER_DISTANCE`, the same tick-per-distance rate
 * an ordinary `JUMP` uses — a tow does not currently move any slower than the
 * player could move under their own power. A distinct, slower tow-speed
 * multiplier (a tow is a favor, not a service the player paid full jump speed
 * for) is a deliberate scope cut left as an explicit M0-12 tuning lever, not
 * an oversight: introducing one now, with no playtesting data to justify a
 * specific value, would be exactly the kind of premature constant this
 * codebase's other placeholders (`RESCUE_CREDIT_SHARE`, `FUEL_PER_DISTANCE`,
 * etc.) avoid.
 *
 * `Math.min(state.vessel.fuelCapacity, ...)` also covers a case that cannot
 * yet be reached: if the cheapest jump out of `destination` ever exceeded
 * `fuelCapacity` (an unreachable-in-slice-0 map shape, since the current
 * two-system map's only depot-to-depot-adjacent leg comfortably fits under
 * `INITIAL_FUEL_CAPACITY`), the grant would clamp at the tank's ceiling
 * rather than overfill it, leaving the player stranded again immediately
 * after being rescued. That outcome is accepted as a clamp, not defended
 * against with a new rejection reason: `RESCUE` has no destination-quality
 * precondition to fail on, only `NOT_STRANDED` and `NO_DEPOT`, and a tow that
 * cannot fully resolve stranding on a pathological future map is still
 * correctly the *nearest* depot — the map, not this spec, would be at fault.
 */
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

    // Fuel is granted relative to the destination, so `fuelCostOf` must see
    // the player as already relocated there before it computes routes out.
    const relocated = { ...state, player: { systemId: destination, docked: true } };
    const minJumpCost = SYSTEMS.filter((s) => s.id !== destination).reduce<number | null>((min, s) => {
      const cost = fuelCostOf(relocated, s.id);
      if (cost === null) {
        return min;
      }
      return min === null ? cost : Math.min(min, cost);
    }, null);
    // No reachable system at all (only possible on a future, richer map) —
    // leave fuel untouched rather than inventing a grant with nothing to size
    // it against.
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
