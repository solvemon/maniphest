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
