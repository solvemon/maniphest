import { hashString, mix64, toUint64 } from '../rng/index.ts';
import type { RngState } from '../rng/index.ts';
import { HOME_SYSTEM_ID } from '../map/index.ts';
import type { RejectionReason } from './rejection.ts';

/**
 * Schema version of the persisted/serialized simulation state shape.
 *
 * Deliberately distinct from `SIM_VERSION` (see `packages/sim/src/version.ts`):
 * `SIM_VERSION` identifies the simulation *build*, while `STATE_VERSION`
 * identifies the *shape* of the state a build reads and writes. A build can
 * change without the state shape changing, and the state shape can need to
 * change independently of a build's other behavior — collapsing the two
 * into one number would force every unrelated release to also be a state
 * migration.
 *
 * Stored alongside serialized state but otherwise uninterpreted for now:
 * nothing yet reads this value to decide how to migrate or reject old
 * state. That logic arrives in M0-10.
 */
export const STATE_VERSION = 1;

/**
 * 10 fuel is exactly one `sol`↔`vega` jump (cost
 * `ceil(10 * FUEL_PER_DISTANCE / fuelEfficiency)` = 10), against a capacity
 * of 20. That makes the opening decision of every run a real one - top the
 * tank up before leaving, or gamble the round trip and strand at `vega`.
 * Still a slice-0 placeholder, to be tuned by M0-12's balance report.
 */
const INITIAL_FUEL = 10;

/**
 * Two `sol`↔`vega` jumps on a full tank - exactly one round trip. Chosen
 * over a bigger tank so that a full top-up is a felt expense (250 of 1000
 * starting credits) rather than a formality. Slice-0 placeholder, tuned by
 * M0-12.
 */
const INITIAL_FUEL_CAPACITY = 20;

/**
 * The baseline hull's divisor in DESIGN.md §8's cost formula, so
 * `sol`↔`vega` costs `ceil(10 * 1 / 1)` = 10 fuel. Kept at `1` so M1's
 * vessel classes only need to change the number, not the formula.
 */
const INITIAL_FUEL_EFFICIENCY = 1;

/**
 * Slice-0 placeholder starting hull integrity. Tuned once damage/repair
 * mechanics land.
 */
const INITIAL_HULL = 100;

/**
 * Slice-0 placeholder starting cargo capacity. Tuned for real balance in
 * M0-07.
 */
const INITIAL_CARGO_CAPACITY = 50;

/**
 * Slice-0 placeholder starting credits. Tuned for real balance in M0-07.
 */
const INITIAL_CREDITS = 1000;

/**
 * The player's location and docking status.
 */
export interface Player {
  systemId: string;
  docked: boolean;
}

/**
 * The player's ship: its fuel, hull integrity, and cargo hold.
 */
export interface Vessel {
  fuel: number;
  /**
   * Current hull integrity. 100 is pristine (undamaged); damage decreases
   * this value. Never optional — see the {@link State} doc comment for why.
   */
  hull: number;
  /**
   * The hard ceiling on `fuel`. `REFUEL` is refused whole — never partially
   * filled — when the requested amount would push `fuel` above this value,
   * rather than silently clamping to the ceiling: a partial fill would mean
   * the actor's requested amount and the amount actually applied diverge,
   * which turns "refuel by X" into a lie the caller has to detect after the
   * fact instead of a request the reducer can reject outright up front.
   */
  fuelCapacity: number;
  /**
   * The divisor in DESIGN.md §8's travel cost formula,
   * `distance * fuelPerUnit / efficiency`. `1` is the baseline hull; values
   * above `1` make travel cheaper. Kept as a per-vessel number rather than
   * folded into the formula or a shared constant so M1's vessel classes can
   * differentiate travel cost by changing only this field, with the cost
   * formula itself untouched.
   */
  fuelEfficiency: number;
  cargoCapacity: number;
  cargo: Record<string, number>;
}

/**
 * The complete simulation state at a given tick.
 *
 * IMPORTANT — no optional (`?`) fields, ever. Every field here (and on every
 * type nested within it, transitively) must be required, with absence
 * represented as `| null` rather than as an omittable/`undefined` property.
 *
 * This is not a style preference: `JSON.stringify` silently drops object
 * properties whose value is `undefined`, and optional fields are exactly the
 * fields that are allowed to be `undefined`. A round-trip through
 * serialization would then produce an object missing keys the original had,
 * breaking the round-trip criterion (serialize → deserialize → identical
 * state) and, later, the deep-equality replay check in M0-09. `| null`
 * serializes and deserializes losslessly, so it is the only allowed way to
 * express "no value" anywhere in this shape.
 */
export interface State {
  version: number;
  worldSeed: number;
  tick: number;
  rng: RngState;
  player: Player;
  vessel: Vessel;
  credits: number;
  lastRejection: { action: unknown; reason: RejectionReason } | null;
}

/**
 * Builds the fresh {@link State} for a new run seeded by `worldSeed`.
 *
 * `rng.seed` is derived from `worldSeed` mixed with an `'event'` domain tag
 * via `mix64(toUint64(worldSeed) ^ hashString('event')) >> 11n`.
 *
 * Cross-issue fix (M0-02 → M0-03): M0-02's stated formula for this
 * derivation yields a `bigint`, which fits neither `RngState.seed: number`
 * nor `JSON.stringify` (which throws on `bigint`). The `>> 11n` truncates
 * the 64-bit mix output down to its top 53 bits, the widest value that
 * still round-trips exactly through `number` (`Number.isSafeInteger`) and
 * through JSON. No randomness quality is lost by this truncation: `eventRng`
 * re-mixes the stored seed with `mix64` again before drawing (see
 * `packages/sim/src/rng/event.ts`), so the 53-bit seed is just an opaque
 * input to a fresh mix, not the raw output consumed directly.
 *
 * `vessel.cargo` is a fresh object literal on every call, never a shared
 * module-level constant — two `initialState` calls must not alias the same
 * cargo record.
 *
 * @throws {RangeError} if `worldSeed` is not a safe integer.
 */
export function initialState(worldSeed: number): State {

  if (!Number.isSafeInteger(worldSeed)) {
    throw new RangeError(
      `initialState(worldSeed): worldSeed must be a safe integer; received ${worldSeed}`,
    );
  }

  const eventSeed = Number(mix64(toUint64(worldSeed) ^ hashString('event')) >> 11n);

  return {
    version: STATE_VERSION,
    worldSeed,
    tick: 0,
    rng: { seed: eventSeed, counter: 0 },
    player: { systemId: HOME_SYSTEM_ID, docked: true },
    vessel: {
      fuel: INITIAL_FUEL,
      hull: INITIAL_HULL,
      fuelCapacity: INITIAL_FUEL_CAPACITY,
      fuelEfficiency: INITIAL_FUEL_EFFICIENCY,
      cargoCapacity: INITIAL_CARGO_CAPACITY,
      cargo: {},
    },
    credits: INITIAL_CREDITS,
    lastRejection: null,
  };
}
