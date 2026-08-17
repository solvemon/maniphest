import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.ts';
import type { State } from './state.ts';

/**
 * Shared fixtures and helpers for `rescue.test.ts`. Kept at the top of the
 * file so later tasks (`RESCUE`'s `NOT_STRANDED`/`NO_DEPOT` rejections, the
 * cargo/credit forfeiture, the fuel grant, and the docked-at-destination
 * landing) can append below and reuse them without duplicating setup.
 */
const SEED = 424242;

/**
 * Options for {@link stateAt}. Every field is optional and `| undefined`
 * explicitly (not just `?`), so named wrappers built on top of this helper
 * can forward their own optional parameters straight through without
 * `exactOptionalPropertyTypes` rejecting an explicit `undefined` value.
 */
interface StateAtOptions {
    systemId?: string | undefined;
    docked?: boolean | undefined;
    fuel?: number | undefined;
    credits?: number | undefined;
    cargo?: Record<string, number> | undefined;
    hull?: number | undefined;
}

/**
 * Builds a `State` derived from `initialState(SEED)` by spreading over it,
 * overriding only `player.systemId`, `player.docked`, `vessel.fuel`,
 * `vessel.cargo`, `vessel.hull`, and `credits` — never as a hand-written
 * object literal.
 *
 * That matters for the same reason `stateAt` in `fuel.test.ts` (and
 * `inSpaceWithFuel` in `movement.test.ts`) is built the same way: `RESCUE`
 * tests prove their result by comparing serialized state before and after —
 * e.g. that cargo is wiped to `{}` while hull passes through untouched, or
 * that everything outside the touched fields is unchanged. A fixture
 * assembled by hand could drift from what `initialState` actually produces
 * (a stale `rng`, a differently-shaped `cargo`, a field this shape gains
 * later, ...), which would make such a comparison spuriously pass or fail
 * for reasons that have nothing to do with rescue. Deriving every fixture
 * from a real `initialState(SEED)` via spreads keeps it
 * serialization-identical to a real state everywhere except the fields
 * under test.
 */
function stateAt({ systemId, docked, fuel, credits, cargo, hull }: StateAtOptions = {}): State {
    const state = initialState(SEED);

    return {
        ...state,
        player: {
            ...state.player,
            systemId: systemId ?? state.player.systemId,
            docked: docked ?? state.player.docked,
        },
        vessel: {
            ...state.vessel,
            fuel: fuel ?? state.vessel.fuel,
            cargo: cargo ?? state.vessel.cargo,
            hull: hull ?? state.vessel.hull,
        },
        credits: credits ?? state.credits,
    };
}

test('should build test states that differ from initialState only in the intended fields', () => {
    // Called with no overrides, `stateAt` must be serialization-identical to
    // `initialState(SEED)` itself - the same smoke test `fuel.test.ts` runs
    // against its own `stateAt`, pinning the "spread, never a hand-written
    // literal" contract this helper's doc comment promises.
    assert.deepStrictEqual(stateAt(), initialState(SEED));
});
