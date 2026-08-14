import type { State } from './state.ts';
import type { RejectionReason } from './rejection.ts';
import { isRejection } from './rejection.ts';
import { ACTIONS } from './registry.ts';

/**
 * Narrows `value` to a plain object: something an object-shaped merge or
 * field lookup can safely walk.
 *
 * Deliberately rejects `null` (`typeof null === 'object'`) and arrays
 * (`Array.isArray`): both pass a bare `typeof value === 'object'` check but
 * neither behaves like a record of named fields, so callers that assumed
 * "object" meant "plain object" would misbehave on either — a `null` read
 * throws on property access, and an array's numeric/`length` keys are not
 * the named fields callers expect.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the rejected-state result for an action that was refused.
 *
 * `tick` is deliberately left untouched: a rejection never advances the
 * simulation clock, since nothing was applied. `action` must be a
 * driver-owned, JSON-safe value — never the raw caller-supplied action —
 * because `lastRejection` lives on `State` and is bound by the same
 * no-optional-fields, round-trips-through-JSON invariant documented on
 * `interface State` (`state.ts`). The raw action has only cleared an
 * `isPlainObject` + `typeof type === 'string'` guard by the time either call
 * site reaches here, so it can still carry `NaN`/`Infinity` (silently become
 * `null`), `undefined` (silently dropped), `bigint`/cyclic references (throw
 * on `JSON.stringify`), or stray properties a spec's `parse` was supposed to
 * strip. Callers of `rejectInto` must pass either a minimal driver-built
 * record (`{ type }`) or an already-normalized, spec-`parse`d action —
 * never `action` itself.
 */
function rejectInto(state: State, action: unknown, reason: RejectionReason): State {
  return { ...state, lastRejection: { action, reason } };
}

/**
 * The single driver every action flows through: parse, apply, then advance
 * the clock — or reject into `lastRejection` at whichever stage fails.
 * Never throws: malformed input, an unknown `action.type`, a parse
 * rejection, and an apply rejection are all handled as data, resulting in
 * either the original `state` reference or a freshly built `State`.
 *
 * The driver holds exclusive authority over `tick` — a handler's `apply`
 * cannot advance the clock itself. The result spread puts `tick` after
 * `...applied`, so any `tick` a handler writes is discarded by construction
 * and only the driver-computed value survives. `duration` is likewise
 * computed from the pre-action `state` (not `applied`), so handlers cannot
 * influence their own duration by mutating state first.
 *
 * Callers distinguish the three possible outcomes by comparing the
 * returned reference and inspecting `lastRejection`:
 *   - `next === prev` — the action was ignored (unknown type or malformed
 *     shape); no `State` was built at all.
 *   - `next.lastRejection` is non-null — the action was parsed as a known
 *     shape but rejected (by `parse` or `apply`).
 *   - otherwise — the action was accepted and applied.
 *
 * A deliberate consequence of the identical-reference path: when an action
 * is ignored, `next` is `prev` untouched, so a *stale* `lastRejection` set
 * by an earlier, unrelated action passes straight through. Callers must
 * treat `next === prev` as "ignored", not as "no rejection pending" — the
 * `lastRejection` field on that returned reference does not describe the
 * current action.
 *
 * The whole dispatch body runs inside a `try`/`catch` that falls back to
 * the identical-reference "ignored" path on any thrown error. `action` is
 * `unknown` and may be hostile — e.g. a property defined via `get()` that
 * throws — so merely reading `action.type` or `action.n` (inside a spec's
 * `parse`/`duration`/`apply`) can throw before any guard has a chance to
 * reject it as data. Without this, such an action would crash the driver
 * instead of being handled like any other malformed input.
 */
export function reduce(state: State, action: unknown): State {
  try {
    if (!isPlainObject(action) || typeof action.type !== 'string') return state;
    const spec = ACTIONS[action.type];
    if (!spec) return state; // unknown → identical ref

    const parsed = spec.parse(action);
    if (isRejection(parsed)) return rejectInto(state, { type: action.type }, parsed.reason);

    const applied = spec.apply(state, parsed);
    if (isRejection(applied)) return rejectInto(state, parsed, applied.reason);

    return { ...applied, tick: state.tick + spec.duration(state, parsed), lastRejection: null };
  } catch {
    return state; // hostile action (e.g. a throwing getter) → ignored, same as malformed input
  }
}

/**
 * Preview API for the harness (M0-11) and later UI: reports the tick cost an
 * action *would* incur without applying it or mutating anything. Walks the
 * same guard/lookup/parse path as `reduce` — malformed input, an unknown
 * `action.type`, or a `parse` rejection all resolve to `null` rather than a
 * number, mirroring the "ignored or rejected" outcomes `reduce` would take at
 * the same stage. Deliberately stops short of calling `spec.apply`: duration
 * is computed from the pre-action `state` alone, so a caller can ask "how
 * long would this take" before deciding whether to commit to it.
 *
 * Wrapped in the same try/catch fallback as `reduce`, for the same reason:
 * a hostile `action` (e.g. a throwing getter) can throw while merely being
 * read, before any guard or `parse` call gets a chance to reject it as
 * data. That case resolves to `null`, same as any other malformed action.
 */
export function durationOf(state: State, action: unknown): number | null {
  try {
    if (!isPlainObject(action) || typeof action.type !== 'string') return null;
    const spec = ACTIONS[action.type];
    if (!spec) return null;

    const parsed = spec.parse(action);
    if (isRejection(parsed)) return null;

    return spec.duration(state, parsed);
  } catch {
    return null;
  }
}
