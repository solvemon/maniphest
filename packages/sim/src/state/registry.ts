import type { ActionSpec, WaitAction } from './actions.ts';
import { defineAction } from './actions.ts';
import { refuelSpec } from './fuel.ts';
import { dockSpec, jumpSpec, undockSpec } from './movement.ts';
import { reject } from './rejection.ts';

/**
 * The driver's lookup table from an action's `type` string to the
 * {@link ActionSpec} that parses, costs, and applies it.
 *
 * Built via `Object.assign(Object.create(null), { … })` rather than an
 * object literal: a literal inherits from `Object.prototype`, so a lookup
 * like `ACTIONS[raw.type]` for an attacker-controlled `raw.type` of
 * `'toString'`, `'__proto__'`, or `'constructor'` would resolve to an
 * inherited function instead of `undefined`, and the driver would then try
 * to call that function as an `ActionSpec` method. A null-prototype object
 * has no inherited properties at all, so any such lookup correctly misses
 * and the driver's "unknown action type" handling takes over.
 *
 * Only `WAIT` for now — see the trailing comment in the object literal below
 * for how later issues extend this registry.
 */
export const ACTIONS: Record<string, ActionSpec> = Object.assign(Object.create(null), {
  WAIT: defineAction<WaitAction>({
    parse: (raw) =>
      typeof raw.n === 'number' && Number.isSafeInteger(raw.n) && raw.n >= 0
        ? { type: 'WAIT', n: raw.n }
        : reject('INVALID_ARGUMENT'),
    duration: (_state, action) => action.n,
    apply: (state, _action) => state, // WAIT changes nothing but the clock
  }),
  JUMP: jumpSpec,
  DOCK: dockSpec,
  UNDOCK: undockSpec,
  REFUEL: refuelSpec,
  // Single append point for new action types: M0-07 adds BUY/SELL. Add each
  // as a new entry here rather than editing the driver in reduce.ts.
});
