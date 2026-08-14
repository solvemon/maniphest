/**
 * Home of the `JUMP`, `DOCK`, and `UNDOCK` action specs (M0-04) and the
 * tick-cost constants those specs are built from.
 *
 * The two-system map, its lane(s), and the posture rules governing docking
 * and undocking all live here rather than in `registry.ts`, so the registry
 * stays a pure lookup table (per its own doc comment) and this file stays
 * the single place movement-specific behavior can change.
 */

/** `DOCK`/`UNDOCK` cost 1 tick each per DESIGN.md §3's action-duration table. */
export const DOCKING_TICKS = 1;

/** Ticks per unit distance for `JUMP`'s `ceil(distance / jumpSpeed)` cost in §3, at the default hull's jumpSpeed of 0.5. */
export const JUMP_TICKS_PER_DISTANCE = 2;
