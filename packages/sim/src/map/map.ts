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
