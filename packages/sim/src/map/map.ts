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
