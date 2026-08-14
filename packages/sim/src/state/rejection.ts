/**
 * Reason code identifying why an action was rejected instead of applied.
 *
 * Deliberately a literal union rather than an `enum`: `erasableSyntaxOnly`
 * forbids enums, and a literal union turns a typo'd reason into a compile
 * error instead of a silently divergent rejection.
 *
 * Beyond `MALFORMED_ACTION` and `INVALID_ARGUMENT`, which apply universally
 * before any domain-specific validation runs, this union carries the
 * movement-posture and system-map reasons added by M0-04:
 *
 * - `NOT_IN_SPACE` covers both a `JUMP` attempted while docked and a `DOCK`
 *   attempted while already docked - both require the ship to be in open
 *   space first.
 * - `NOT_DOCKED` is the posture failure for an action that requires being
 *   docked. Nothing in this issue emits it yet; it is the reason M0-07's
 *   trading gate will use to reject trading while in space.
 * - `SAME_SYSTEM` rejects a `JUMP` whose destination is the system the ship
 *   is already in.
 * - `UNKNOWN_SYSTEM` rejects a `JUMP` whose destination does not exist in
 *   the system map.
 *
 * Later issues extend it with more specific reasons as their subsystems
 * land:
 *
 * - M0-05 adds `INSUFFICIENT_FUEL` and `NO_DEPOT`.
 * - M0-07 adds `INSUFFICIENT_CREDITS`, `INSUFFICIENT_CARGO_SPACE`, and
 *   `INSUFFICIENT_STOCK`.
 */
export type RejectionReason =
  | 'MALFORMED_ACTION'
  | 'INVALID_ARGUMENT'
  | 'NOT_DOCKED'
  | 'NOT_IN_SPACE'
  | 'SAME_SYSTEM'
  | 'UNKNOWN_SYSTEM';

/**
 * The result of an action that was not applied.
 *
 * `rejected` is a literal `true` rather than `boolean` so the field itself
 * acts as a discriminant: code narrowing on `rejected` gets a compile-time
 * guarantee that `reason` is present, without a separate type guard.
 */
export interface Rejection {
  readonly rejected: true;
  reason: RejectionReason;
}

/**
 * Builds a {@link Rejection} for the given reason.
 *
 * A plain factory function rather than a class constructor: rejections are
 * inert data returned from reducers, and a function keeps call sites terse
 * (`return reject('INVALID_ARGUMENT')`) without any `new` ceremony.
 */
export function reject(reason: RejectionReason): Rejection {
  return { rejected: true, reason };
}

/**
 * Narrows `value` to a {@link Rejection}.
 *
 * The sentinel is deliberately *not* a `State`: a `Rejection` and a `State`
 * are disjoint shapes, so a handler cannot return something that is half one
 * and half the other. Checking `rejected === true` here is what lets callers
 * branch cleanly on "was this applied or rejected?" without a handler ever
 * being able to half-apply and reject.
 */
export function isRejection(value: unknown): value is Rejection {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { rejected?: unknown }).rejected === true
  );
}
