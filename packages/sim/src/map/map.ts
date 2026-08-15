/**
 * A single travelable location on the map.
 */
export interface System {
    id: string;
    name: string;
}

/**
 * The full set of systems in the current slice-0 map.
 *
 * Hardcoded to exactly two systems for now: `'sol'` and `'vega'`. Later
 * tasks add the home system id, inter-system distances, and lookup helpers
 * derived from this list.
 */
export const SYSTEMS: readonly System[] = [
    { id: 'sol', name: 'Sol' },
    { id: 'vega', name: 'Vega' },
];

/**
 * The system the ship starts at.
 *
 * This is derived from `SYSTEMS` rather than a second hardcoded id: "the
 * ship starts at the first system" is a structural rule about the map, not
 * an independent fact that could drift out of sync with `SYSTEMS`.
 */
export const HOME_SYSTEM_ID = SYSTEMS[0]!.id;

/**
 * Inter-system distances, keyed by an order-independent pair key.
 *
 * A pair of system ids `a` and `b` is keyed by `[a, b].sort().join('|')`, so
 * the two ids are sorted before joining. That canonical key is independent
 * of travel direction, so a single entry covers both `a` to `b` and `b` to
 * `a` — there is no need for a separate reverse entry.
 *
 * Built on a null-prototype object (via `Object.create(null)`) so lookups
 * can never accidentally resolve to an inherited property such as
 * `toString` or `constructor`.
 */
const DISTANCES: Record<string, number> = Object.assign(Object.create(null), {
    'sol|vega': 10,
});

/**
 * Lookup of every system in `SYSTEMS`, indexed by its id.
 *
 * Built on a null-prototype object (via `Object.create(null)`) so lookups
 * can never accidentally resolve to an inherited property such as
 * `toString` or `constructor`.
 */
const BY_ID: Record<string, System> = Object.create(null);
for (const system of SYSTEMS) {
    BY_ID[system.id] = system;
}

/**
 * Looks up a system by its id.
 *
 * Returns `null` for an unknown id rather than throwing, so callers in the
 * action loop can turn a bad id into a `Rejection` result instead of an
 * exception unwinding the call stack.
 */
export function systemById(id: string): System | null {
    return BY_ID[id] ?? null;
}

/**
 * Looks up the distance between two systems by id.
 *
 * Returns `null` if either id fails `systemById`, so callers can turn a bad
 * id into a `Rejection` result instead of an exception unwinding the call
 * stack. Returns `0` when `a` and `b` are the same id, without consulting
 * `DISTANCES`. Otherwise builds the order-independent pair key via
 * `[a, b].sort().join('|')` and looks it up in `DISTANCES`, returning `null`
 * if no distance is recorded for that pair. Never throws.
 */
export function distanceBetween(a: string, b: string): number | null {
    if (systemById(a) === null || systemById(b) === null) {
        return null;
    }

    if (a === b) {
        return 0;
    }

    const key = [a, b].sort().join('|');
    return DISTANCES[key] ?? null;
}
