import type { State } from './state.ts';
import type { Rejection } from './rejection.ts';

/**
 * Advances the simulation by `n` ticks without taking any other action.
 */
export interface WaitAction {
  type: 'WAIT';
  n: number;
}

/**
 * Moves the ship to `systemId`, the destination system of a lane in the
 * two-system map.
 */
export interface JumpAction {
  type: 'JUMP';
  systemId: string;
}

/**
 * Docks the ship at a station in its current system.
 */
export interface DockAction {
  type: 'DOCK';
}

/**
 * Undocks the ship from a station, returning it to open space.
 */
export interface UndockAction {
  type: 'UNDOCK';
}

/**
 * The set of actions a reducer can apply to a {@link State}.
 *
 * `WaitAction`, `JumpAction`, `DockAction`, and `UndockAction` are the
 * actions slice-0 needs. Later issues widen this union as their subsystems
 * land:
 *
 * - M0-05 adds `RefuelAction`.
 * - M0-07 adds `BuyAction` and `SellAction`.
 */
export type Action = WaitAction | JumpAction | DockAction | UndockAction;

/**
 * The driver-facing, monomorphic shape every action kind implements.
 *
 * `unknown` rather than a specific action type: this interface is the
 * contract a driver dispatches through without knowing which concrete
 * action it holds, so `parse`, `duration`, and `apply` all speak in
 * `unknown` and each implementation narrows internally. `parse` returns
 * either the parsed action or a {@link Rejection}, letting malformed input
 * be rejected before `duration` or `apply` ever run.
 */
export interface ActionSpec {
  /**
   * Validates `raw` and normalizes it into the action shape by rebuilding
   * the result from known fields rather than passing `raw` through
   * untouched — so stray properties on `raw` can't leak into state via
   * `lastRejection` or a handler.
   */
  parse(raw: Record<string, unknown>): unknown;
  /** The cost, in ticks, of `action` — evaluated against the pre-action `state`. */
  duration(state: State, action: unknown): number;
  /**
   * Decides whether `action` is legal against `state` and returns either
   * the resulting `State` or a {@link Rejection} — one atomic decision, so
   * callers never observe a partially-mutated state.
   *
   * Event-RNG call convention: a handler that needs randomness constructs
   * the generator from the incoming state, draws from it, and persists the
   * result in the same call — `const rng = eventRng(state.rng)`, draw, then
   * `return { ...state, rng: rng.snapshot() }`. The generator must never be
   * held across a reducer boundary; each `apply` call gets its own.
   */
  apply(state: State, action: unknown): State | Rejection;
  /**
   * The ship posture required for this action to be legal — `'docked'` or
   * `'inSpace'`. Absent ⇒ legal in either posture.
   */
  requires?: 'docked' | 'inSpace';
}

/**
 * Builds an {@link ActionSpec} from strongly-typed handlers, confining the
 * `unknown`-to-`A` cast to this one helper.
 *
 * `ActionSpec` is deliberately monomorphic (`unknown` rather than a generic
 * parameter): a driver that dispatches through `Record<string, ActionSpec<A>>`
 * would need the key it looked up by to determine which `A` the value's
 * `duration`/`apply` accept, but a lookup's return type is keyed only on the
 * map's value type, not on the specific key used — TypeScript cannot
 * correlate "this is the `WAIT` entry" with "so `action` here is
 * `WaitAction`". Widening the union of specs to match the union of actions
 * loses exactly the per-kind narrowing the driver needs, so `ActionSpec`
 * erases to `unknown` instead.
 *
 * That erasure only needs a cast at the boundary, not throughout every
 * handler: the driver always calls `duration`/`apply` on the exact value its
 * own `parse` just returned, never a value from a different action's spec,
 * so the two casts below never actually cross a type they didn't come from.
 * `defineAction` is the single place that cast happens, so every other
 * handler is written against `A` and never touches `unknown` directly.
 */
export function defineAction<A>(spec: {
  parse: (raw: Record<string, unknown>) => A | Rejection;
  duration: (state: State, action: A) => number;
  apply: (state: State, action: A) => State | Rejection;
  /**
   * The ship posture required for this action to be legal — `'docked'` or
   * `'inSpace'`. Absent ⇒ legal in either posture.
   */
  requires?: 'docked' | 'inSpace';
}): ActionSpec {
  return {
    parse: (raw) => spec.parse(raw),
    duration: (state, action) => spec.duration(state, action as A), // the ONE cast
    apply: (state, action) => spec.apply(state, action as A), // the ONE cast
    // `exactOptionalPropertyTypes` treats an explicit `requires: undefined`
    // as different from an absent key, so the key must be omitted entirely
    // rather than assigned `undefined` when the spec didn't set it.
    ...(spec.requires === undefined ? {} : { requires: spec.requires }),
  };
}
