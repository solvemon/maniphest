import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.ts';
import type { State } from './state.ts';
import { reduce } from './reduce.ts';
import { fuelCostOf, isStranded } from './fuel.ts';
import { hasDepot, SYSTEMS } from '../map/index.ts';
import { RESCUE_CREDIT_SHARE } from './rescue.ts';

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

test('should accept a RESCUE after stranding is reached through legal play', () => {
    // AC #4 for RESCUE itself: a tow must be reachable through legal play,
    // not just constructible by hand - the same proof `fuel.test.ts`'s
    // "should reach stranding from a legal action sequence" runs for
    // `isStranded` alone, carried one step further into `RESCUE`. Starting
    // fuel (10) is exactly the sol-to-vega jump's cost, so `UNDOCK` (free)
    // followed by a `JUMP` to `vega` - a depot-less system - spends the tank
    // to 0 in two ordinary moves and leaves the player genuinely stranded.
    let s = initialState(SEED);
    assert.equal(isStranded(s), false);

    s = reduce(s, { type: 'UNDOCK' });
    assert.equal(s.lastRejection, null);

    s = reduce(s, { type: 'JUMP', systemId: 'vega' });
    assert.equal(s.lastRejection, null);
    assert.equal(s.vessel.fuel, 0);
    assert.equal(isStranded(s), true);

    s = reduce(s, { type: 'RESCUE' });

    // `lastRejection === null` proves the tow was actually applied, not
    // rejected as `NOT_STRANDED` or `NO_DEPOT` - the player genuinely is
    // stranded, and `sol` (the only depot on the slice-0 map) is reachable
    // as a rescue destination.
    assert.equal(s.lastRejection, null);
});

test('should empty cargo and take its credit share on a tow', () => {
    // AC #1: a stranded player carrying cargo is towed for a credit fee - the
    // tow forfeits every unit of cargo (down to a fresh `{}`, per rescue.ts's
    // doc comment on aliasing) and takes `RESCUE_CREDIT_SHARE` of credits,
    // rounded up via `Math.ceil` the same way `rescueSpec.apply` computes it,
    // so this test can never drift out of step with a future tuning of the
    // constant's value.
    const before = stateAt({ systemId: 'vega', fuel: 0, credits: 1000, cargo: { ore: 5, water: 2 } });
    assert.equal(isStranded(before), true);

    const after = reduce(before, { type: 'RESCUE' });

    assert.equal(after.lastRejection, null);
    assert.deepStrictEqual(after.vessel.cargo, {});
    assert.equal(after.credits, before.credits - Math.ceil(before.credits * RESCUE_CREDIT_SHARE));
});

test('should give the post-tow cargo a fresh object identity, never aliased', () => {
    // AC #1b: rescue.ts's doc comment on `apply` promises a fresh `{}`
    // literal on every call, never a shared module-level constant - two
    // rescues (or a rescue and a fresh run) must never end up with
    // `Vessel.cargo` objects that are the same reference, or a mutation via
    // one player's state would silently leak into the other's. `deepStrictEqual`
    // alone (as in the test above) cannot catch that: two aliased `{}`
    // references are just as deep-equal as two independent ones.
    const before = stateAt({ systemId: 'vega', fuel: 0, cargo: { ore: 5 } });
    const after = reduce(before, { type: 'RESCUE' });
    assert.notStrictEqual(after.vessel.cargo, before.vessel.cargo);

    const otherBefore = stateAt({ systemId: 'vega', fuel: 0, cargo: { water: 3 } });
    const otherAfter = reduce(otherBefore, { type: 'RESCUE' });
    assert.notStrictEqual(after.vessel.cargo, otherAfter.vessel.cargo);
});

test('should tow a stranded player to a depot with enough fuel for a jump, docked', () => {
    // AC #3: the tow must not just move the player - it must resolve the
    // stranding outright, landing them docked at an actual depot with enough
    // fuel in the tank to make at least one more jump.
    const before = stateAt({ systemId: 'vega', fuel: 0 });
    assert.equal(isStranded(before), true);

    const after = reduce(before, { type: 'RESCUE' });
    assert.equal(after.lastRejection, null);

    assert.equal(hasDepot(after.player.systemId), true);
    assert.equal(
        SYSTEMS.some((s) => {
            if (s.id === after.player.systemId) {
                return false;
            }
            const cost = fuelCostOf(after, s.id);
            return cost !== null && cost <= after.vessel.fuel;
        }),
        true,
    );
    assert.equal(isStranded(after), false);
    assert.ok(after.vessel.fuel <= after.vessel.fuelCapacity);
    assert.equal(after.player.docked, true);
});
