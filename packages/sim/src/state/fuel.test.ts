import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from './state.ts';
import type { State } from './state.ts';
import {
    fuelCostOf,
    isStranded,
    FUEL_PER_DISTANCE,
    FUEL_PRICE_PER_UNIT,
    REFUEL_TICKS,
} from './fuel.ts';
import { distanceBetween } from '../map/index.ts';
import { reduce } from './reduce.ts';
import type { RejectionReason } from './rejection.ts';

/**
 * Shared fixtures and helpers for `fuel.test.ts`. Kept at the top of the
 * file so later tasks (fuel-cost math, `REFUEL` acceptance and rejection
 * paths, and stranding detection) can append below and reuse them without
 * duplicating setup.
 */
const SEED = 424242;

/**
 * Options for {@link stateAt}. Every field is optional and `| undefined`
 * explicitly (not just `?`), so the named wrappers below can forward their
 * own optional `fuel`/`credits` parameters straight through without
 * `exactOptionalPropertyTypes` rejecting an explicit `undefined` value.
 */
interface StateAtOptions {
    systemId?: string | undefined;
    docked?: boolean | undefined;
    fuel?: number | undefined;
    credits?: number | undefined;
}

/**
 * Builds a `State` derived from `initialState(SEED)` by spreading over it,
 * overriding only `player.systemId`, `player.docked`, `vessel.fuel`, and
 * `credits` — never as a hand-written object literal.
 *
 * That matters for the same reason `inSpaceWithFuel` in `movement.test.ts`
 * is built the same way: several fuel tests (`INSUFFICIENT_FUEL`,
 * `FUEL_CAPACITY_EXCEEDED`, `INSUFFICIENT_CREDITS`, stranding, ...) prove a
 * result by comparing the whole serialized state before and after, e.g.
 * excluding only `lastRejection`. A fixture assembled by hand could drift
 * from what `initialState` actually produces (a stale `rng`, a
 * differently-shaped `cargo`, a field this shape gains later, ...), which
 * would make that whole-state comparison spuriously pass or fail for
 * reasons that have nothing to do with fuel. Deriving every fixture from a
 * real `initialState(SEED)` via spreads keeps it serialization-identical to
 * a real state everywhere except the fields under test.
 */
function stateAt({ systemId, docked, fuel, credits }: StateAtOptions = {}): State {
    const state = initialState(SEED);

    return {
        ...state,
        player: {
            ...state.player,
            systemId: systemId ?? state.player.systemId,
            docked: docked ?? state.player.docked,
        },
        vessel: { ...state.vessel, fuel: fuel ?? state.vessel.fuel },
        credits: credits ?? state.credits,
    };
}

/**
 * Docked at `'sol'` — the home system, and exactly what `initialState(SEED)`
 * already is. Called with no overrides, this is serialization-identical to
 * `initialState(SEED)` itself (see the smoke test below).
 */
function dockedAtSol(fuel?: number, credits?: number): State {
    return stateAt({ systemId: 'sol', docked: true, fuel, credits });
}

/**
 * Docked at `'vega'` — a system with no depot (see `map.ts`'s `SYSTEMS`),
 * unlike `dockedAtSol`.
 */
function dockedAtVega(fuel?: number, credits?: number): State {
    return stateAt({ systemId: 'vega', docked: true, fuel, credits });
}

/**
 * In space (undocked) at `'vega'`.
 */
function inSpaceAtVega(fuel?: number, credits?: number): State {
    return stateAt({ systemId: 'vega', docked: false, fuel, credits });
}

/**
 * In space (undocked) at `'sol'`.
 *
 * Exists so a later `NOT_DOCKED` test can prove that reason is about
 * posture — being undocked — and not about location: `'sol'` has a depot,
 * so a `REFUEL` rejected from this state can only be explained by the ship
 * being in space, never by the destination lacking a depot.
 */
function inSpaceAtSol(fuel?: number, credits?: number): State {
    return stateAt({ systemId: 'sol', docked: false, fuel, credits });
}

/**
 * Asserts that `reduce(prev, action)` takes the rejection path with
 * `expected` as the reason, and that the result satisfies every invariant
 * a rejection must: the tick does not advance, the offending `action` is
 * recorded verbatim, and nothing else in `state` changes - proved by
 * comparing `next` and `prev` serialized whole, with only `lastRejection`
 * excluded.
 *
 * Same shape as `movement.test.ts`'s `assertRejected`; kept local here since
 * no shared rejection-assert helper lives in `./test-helpers.ts`.
 */
function assertRejected(prev: State, action: unknown, expected: RejectionReason): void {
    const next = reduce(prev, action);

    assert.notEqual(next, prev);
    assert.equal(next.tick, prev.tick);
    assert.equal(next.lastRejection?.reason, expected);
    assert.deepStrictEqual(next.lastRejection?.action, action);
    assert.equal(
        JSON.stringify({ ...next, lastRejection: null }),
        JSON.stringify({ ...prev, lastRejection: null }),
    );
}

/**
 * Asserts that `reduce(prev, action)` rejects `action` with `expected`
 * because `action` fails a spec's `parse` outright — e.g. a `REFUEL` whose
 * `units` is not a positive integer.
 *
 * Deliberately not {@link assertRejected}: `reduce`'s `rejectInto` call for
 * a parse-stage rejection stores only `{ type: action.type }` in
 * `lastRejection.action` (see `reduce.ts`), discarding whatever malformed
 * value `action` carried — a value that failed `parse` may not even be
 * JSON-safe (`NaN`, `undefined`, a cyclic reference, ...), so it must never
 * reach `lastRejection` verbatim. `assertRejected` checks the recorded
 * action against `action` itself, which only holds for a spec whose `parse`
 * succeeded; this variant checks it against that trimmed `{ type: ... }`
 * shape instead, and is otherwise identical.
 *
 * Same shape as `movement.test.ts`'s `assertRejectedMalformed`; kept local
 * here since no shared malformed-action-assert helper lives in
 * `./test-helpers.ts`.
 */
function assertRejectedMalformed(
    prev: State,
    action: Record<string, unknown>,
    expected: RejectionReason,
): void {
    const next = reduce(prev, action);

    assert.notEqual(next, prev);
    assert.equal(next.tick, prev.tick);
    assert.equal(next.lastRejection?.reason, expected);
    assert.deepStrictEqual(next.lastRejection?.action, { type: action['type'] });
    assert.equal(
        JSON.stringify({ ...next, lastRejection: null }),
        JSON.stringify({ ...prev, lastRejection: null }),
    );
}

test('should build test states that differ from initialState only in the intended fields', () => {
    assert.deepStrictEqual(dockedAtSol(), initialState(SEED));
});

test('should compute the sol-to-vega jump cost from the map and fuel constants', () => {
    const state = dockedAtSol();
    const expectedCost = Math.ceil(
        (distanceBetween('sol', 'vega')! * FUEL_PER_DISTANCE) / state.vessel.fuelEfficiency,
    );

    assert.equal(fuelCostOf(state, 'vega'), expectedCost);
});

test('should return null from fuelCostOf for an unknown destination', () => {
    // Callers turn this `null` into a `NO_ROUTE` rejection.
    assert.equal(fuelCostOf(dockedAtSol(), 'nowhere'), null);
});

test('should return zero from fuelCostOf for the current system', () => {
    // This `0` is deliberately NOT treated as an escape by `isStranded`: a
    // jump to the current system is never a legal action in the first
    // place (`jumpSpec.apply` rejects it as `SAME_SYSTEM` before cost is
    // ever computed), so a free "jump" to where the player already is
    // cannot rescue them.
    assert.equal(fuelCostOf(dockedAtSol(), 'sol'), 0);
});

test('should refuel at a depot, adding units and charging credits', () => {
    const before = dockedAtSol();

    const next = reduce(before, { type: 'REFUEL', units: 5 });

    assert.equal(next.vessel.fuel, 15);
    assert.equal(next.credits, before.credits - 5 * FUEL_PRICE_PER_UNIT);
    assert.equal(next.tick, before.tick + REFUEL_TICKS);
    assert.equal(next.lastRejection, null);
});

test('should allow refuelling to exactly fuel capacity', () => {
    // Only strictly exceeding capacity is `FUEL_CAPACITY_EXCEEDED`; filling
    // to exactly the ceiling must succeed, so this pins the boundary
    // against an off-by-one.
    const before = dockedAtSol();
    const units = before.vessel.fuelCapacity - before.vessel.fuel;

    const after = reduce(before, { type: 'REFUEL', units });

    assert.equal(after.lastRejection, null);
    assert.equal(after.vessel.fuel, after.vessel.fuelCapacity);
});

test('should reject REFUEL with FUEL_CAPACITY_EXCEEDED when the request overfills the tank', () => {
    const before = dockedAtSol(10);
    const units = before.vessel.fuelCapacity - before.vessel.fuel + 1;

    assertRejected(before, { type: 'REFUEL', units }, 'FUEL_CAPACITY_EXCEEDED');
});

test('should reject REFUEL with INSUFFICIENT_CREDITS when the units cannot be afforded', () => {
    // Default fuel (10) plus these 5 units stays well under the default
    // 20-unit capacity, so the capacity check cannot be what trips this
    // rejection - only the credit gate can.
    const units = 5;
    const before = dockedAtSol(undefined, units * FUEL_PRICE_PER_UNIT - 1);

    // The request is refused whole; the player does not get "as much fuel
    // as they can afford", because that would silently hide a failed
    // intent from the caller. `assertRejected` proves that whole-refusal:
    // no partial fill, no partial charge.
    assertRejected(before, { type: 'REFUEL', units }, 'INSUFFICIENT_CREDITS');
});

test('should reject REFUEL with NO_DEPOT when docked at a system without one', () => {
    // Plenty of tank room (fuel 0) and plenty of credits, so neither
    // FUEL_CAPACITY_EXCEEDED nor INSUFFICIENT_CREDITS could plausibly be
    // the blocker - only `vega` lacking a depot can explain the rejection.
    const before = dockedAtVega(0, 1_000_000);

    // `refuelSpec.apply` checks location before physics and economics: a
    // request that would also be unaffordable or oversized still reports
    // NO_DEPOT first, since there is no point pricing fuel at a place that
    // sells none.
    assertRejected(before, { type: 'REFUEL', units: 5 }, 'NO_DEPOT');
});

test('should reject REFUEL with NOT_DOCKED when the ship is in space', () => {
    // `NOT_DOCKED` is a posture gate, not a location check, and it runs
    // before `refuelSpec.apply`'s own `NO_DEPOT` check. Both in-space
    // fixtures prove that: `inSpaceAtSol` floats right above the map's only
    // depot yet is still refused, showing location cannot explain the
    // rejection - only being undocked can. `inSpaceAtVega` is in space away
    // from any depot, so it demonstrates the gate short-circuits before
    // `apply` would otherwise report `NO_DEPOT`. This is the first action to
    // actually exercise the `NOT_DOCKED` reason M0-04 reserved.
    assertRejected(inSpaceAtSol(), { type: 'REFUEL', units: 5 }, 'NOT_DOCKED');
    assertRejected(inSpaceAtVega(), { type: 'REFUEL', units: 5 }, 'NOT_DOCKED');
});

test('should reject REFUEL with INVALID_ARGUMENT for a non-positive or non-integer units', () => {
    // Docked at `sol` - a valid depot, with default fuel and credits well
    // within capacity and affordability - so nothing but `units` itself
    // could plausibly cause the rejection in any of these cases.
    const before = dockedAtSol();

    // `refuelSpec.parse` (fuel.ts) accepts only a `units` that is
    // `typeof 'number'` and `Number.isSafeInteger`, `>= 1`. `Number.isSafeInteger`
    // is specifically what excludes `NaN` and `Infinity` here (both are
    // `typeof 'number'` but neither is a safe integer), which is also what
    // keeps `lastRejection.action` JSON-safe per `rejectInto`'s contract in
    // `reduce.ts` - a `NaN` would silently serialize to `null` and corrupt
    // the replay record, so it must never reach `lastRejection` at all.
    const cases: ReadonlyArray<{ label: string; action: Record<string, unknown> }> = [
        { label: 'zero', action: { type: 'REFUEL', units: 0 } },
        { label: 'negative', action: { type: 'REFUEL', units: -1 } },
        { label: 'non-integer', action: { type: 'REFUEL', units: 1.5 } },
        { label: 'NaN', action: { type: 'REFUEL', units: NaN } },
        { label: 'Infinity', action: { type: 'REFUEL', units: Infinity } },
        { label: 'string', action: { type: 'REFUEL', units: '10' } },
        { label: 'null', action: { type: 'REFUEL', units: null } },
        { label: 'missing', action: { type: 'REFUEL' } },
    ];

    for (const { action } of cases) {
        assertRejectedMalformed(before, action, 'INVALID_ARGUMENT');
    }
});

test('should strip a stray property from an accepted REFUEL before it reaches state', () => {
    // `REFUEL`'s `parse` rebuilds `{ type: 'REFUEL', units }` from scratch
    // (fuel.ts), so an accepted action carrying an extra property must be
    // normalized away rather than merged into `next` verbatim. This is the
    // accepted-path counterpart to `assertRejected`'s verbatim-action note
    // above: here the action is legal, so `next` must show no trace of
    // `sneaky` anywhere - not just in `lastRejection.action`, but nowhere in
    // the resulting state at all.
    const before = dockedAtSol();

    const after = reduce(before, { type: 'REFUEL', units: 5, sneaky: true });

    assert.equal(after.vessel.fuel, before.vessel.fuel + 5);
    assert.equal(after.credits, before.credits - 5 * FUEL_PRICE_PER_UNIT);
    assert.equal(after.tick, before.tick + REFUEL_TICKS);
    assert.equal(after.lastRejection, null);
    assert.ok(!JSON.stringify(after).includes('sneaky'));
});

test('should report stranding only away from a depot and only below the jump cost', () => {
    // `cost` is derived from `fuelCostOf` itself - the vega-to-sol jump cost
    // on a fresh `initialState(SEED)` vessel - rather than hardcoded as a
    // literal. `fuelCostOf`, `FUEL_PER_DISTANCE`, and `FUEL_PRICE_PER_UNIT`
    // are all placeholder balance values slated for an M0-12 retune; if that
    // retune changes the sol<->vega distance or the fuel-per-distance rate,
    // a hardcoded expected cost here would silently fall out of sync with
    // reality and this table would stop testing what it claims to. Deriving
    // `cost` keeps the table valid across any such retune.
    const cost = fuelCostOf(dockedAtVega(), 'sol')!;
    assert.ok(cost > 0, 'sanity check: the vega-to-sol jump must cost some fuel');

    const cases: ReadonlyArray<{ label: string; state: State; expected: boolean }> = [
        { label: 'sol, 0 fuel, docked', state: dockedAtSol(0), expected: false },
        { label: 'sol, 0 fuel, in space', state: inSpaceAtSol(0), expected: false },
        { label: 'sol, cost-1 fuel, docked', state: dockedAtSol(cost - 1), expected: false },
        { label: 'sol, cost-1 fuel, in space', state: inSpaceAtSol(cost - 1), expected: false },
        { label: 'sol, cost fuel, docked', state: dockedAtSol(cost), expected: false },
        { label: 'sol, cost fuel, in space', state: inSpaceAtSol(cost), expected: false },
        { label: 'vega, 0 fuel, docked', state: dockedAtVega(0), expected: true },
        { label: 'vega, 0 fuel, in space', state: inSpaceAtVega(0), expected: true },
        { label: 'vega, cost-1 fuel, docked', state: dockedAtVega(cost - 1), expected: true },
        { label: 'vega, cost-1 fuel, in space', state: inSpaceAtVega(cost - 1), expected: true },
        { label: 'vega, cost fuel, docked', state: dockedAtVega(cost), expected: false },
        { label: 'vega, cost fuel, in space', state: inSpaceAtVega(cost), expected: false },
    ];

    for (const { label, state, expected } of cases) {
        assert.equal(isStranded(state), expected, label);
    }
});

test('should give the same isStranded answer regardless of docking posture', () => {
    // `UNDOCK` is free, and DESIGN.md §8 defines stranded as "docked or
    // adrift with insufficient fuel for any legal jump, and not at a depot" -
    // so posture cannot change whether the player is actually stuck. Rather
    // than re-listing the expected booleans (the truth-table test above
    // already pins those), this proves the invariant directly: flipping
    // `player.docked` on an otherwise-identical state must never change
    // `isStranded`'s answer.
    const cost = fuelCostOf(dockedAtVega(), 'sol')!;

    const cases: ReadonlyArray<{ label: string; systemId: string; fuel: number }> = [
        { label: 'sol, 0 fuel', systemId: 'sol', fuel: 0 },
        { label: 'sol, cost-1 fuel', systemId: 'sol', fuel: cost - 1 },
        { label: 'sol, cost fuel', systemId: 'sol', fuel: cost },
        { label: 'vega, 0 fuel', systemId: 'vega', fuel: 0 },
        { label: 'vega, cost-1 fuel', systemId: 'vega', fuel: cost - 1 },
        { label: 'vega, cost fuel', systemId: 'vega', fuel: cost },
    ];

    for (const { label, systemId, fuel } of cases) {
        const s = stateAt({ systemId, fuel });
        const docked = { ...s, player: { ...s.player, docked: true } };
        const inSpace = { ...s, player: { ...s.player, docked: false } };

        assert.equal(isStranded(docked), isStranded(inSpace), label);
    }
});

test('should not consider a player at a depot stranded even with no fuel and no credits', () => {
    // AC #3's literal wording is "true exactly when no legal jump exists and
    // the player is not at a depot" - broke-at-a-depot (no fuel, no credits
    // to buy any) is an economy problem, not a stranding one, so it is
    // deliberately left out of this predicate. Folding it in would exceed
    // the stated contract and hand M0-06's tow a case it cannot fix: towing
    // the player to the depot they are already standing on changes nothing.
    // It is left visible, unmasked, for M0-12's balance report to measure.
    assert.equal(isStranded(dockedAtSol(0, 0)), false);
    assert.equal(isStranded(inSpaceAtSol(0, 0)), false);
});

test('should reach stranding from a legal action sequence', () => {
    // AC #4: stranding must be reachable through legal play, not just
    // constructible by hand. `initialState(SEED)` is used directly here -
    // never `stateAt`/`dockedAtSol` and their fuel/credits overrides - so
    // this proves the *default* opening state, the one any real playthrough
    // actually starts from, leads to stranding in two ordinary moves. The
    // run is over in exactly two actions because the starting tank (10
    // fuel) is exactly one sol-to-vega jump's cost: `UNDOCK` is free, and
    // the `JUMP` to `vega` - a depot-less system - spends the tank down to
    // 0 in a single legal step.
    let s = initialState(SEED);
    assert.equal(isStranded(s), false);

    s = reduce(s, { type: 'UNDOCK' });
    assert.equal(s.lastRejection, null);

    s = reduce(s, { type: 'JUMP', systemId: 'vega' });
    assert.equal(s.lastRejection, null);
    assert.equal(s.vessel.fuel, 0);
    assert.equal(isStranded(s), true);
});

test('should avoid stranding by refuelling before departure', () => {
    // This proves the fail state is a choice, not an inevitability: the
    // exact same opening that strands a careless player in two moves (the
    // test above) completes a full sol -> vega -> sol round trip for a
    // player who tops the tank up first. Together with the AC #4 test, this
    // pins both sides of DESIGN.md's "loss must be possible" principle -
    // stranding is reachable through legal play, but so is avoiding it.
    let s = initialState(SEED);
    assert.equal(isStranded(s), false);

    // Derived from fuelCapacity - fuel rather than hardcoded, so this stays
    // valid across any M0-12 retune of the starting fuel or capacity.
    const units = s.vessel.fuelCapacity - s.vessel.fuel;

    s = reduce(s, { type: 'REFUEL', units });
    assert.equal(s.lastRejection, null);
    assert.equal(s.vessel.fuel, s.vessel.fuelCapacity);
    assert.equal(isStranded(s), false);

    s = reduce(s, { type: 'UNDOCK' });
    assert.equal(s.lastRejection, null);
    assert.equal(isStranded(s), false);

    s = reduce(s, { type: 'JUMP', systemId: 'vega' });
    assert.equal(s.lastRejection, null);
    assert.equal(s.player.systemId, 'vega');
    assert.equal(isStranded(s), false);

    s = reduce(s, { type: 'DOCK' });
    assert.equal(s.lastRejection, null);
    assert.equal(isStranded(s), false);

    s = reduce(s, { type: 'UNDOCK' });
    assert.equal(s.lastRejection, null);
    assert.equal(isStranded(s), false);

    s = reduce(s, { type: 'JUMP', systemId: 'sol' });
    assert.equal(s.lastRejection, null);
    assert.equal(isStranded(s), false);

    // The round trip lands back home, in space (JUMP always leaves the ship
    // undocked in its destination system).
    assert.equal(s.player.systemId, 'sol');
    assert.equal(s.player.docked, false);
});
