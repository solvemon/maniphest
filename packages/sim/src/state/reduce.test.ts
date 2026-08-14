import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, durationOf } from './reduce.ts';
import { initialState } from './state.ts';
import type { State } from './state.ts';
import { findUndefined } from './test-helpers.ts';
import { defineAction } from './actions.ts';
import { ACTIONS } from './registry.ts';

/**
 * Shared fixtures and helpers for `reduce.test.ts`. Kept at the top of the
 * file so later tasks (the full WAIT suite, rejection-path tests, and
 * beyond) can append below and reuse them without duplicating setup.
 */
const SEED = 909090;

/**
 * Recursively freezes `value` in place: every plain object and array
 * reachable from it (including `value` itself) is frozen with
 * `Object.freeze`, so a later attempt to mutate it throws instead of
 * silently succeeding or silently no-oping.
 *
 * Used by tests below to prove that `reduce` never mutates the `state` it
 * is given - passing a deep-frozen state in means any in-place write
 * inside `reduce` (or an action handler it dispatches to) throws
 * immediately rather than passing unnoticed.
 *
 * Only descends into plain objects and arrays; anything else (numbers,
 * strings, `null`, functions, ...) has no mutable structure to freeze and
 * is returned untouched.
 */
function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }

        Object.freeze(value);

        return value;
    }

    if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }

        Object.freeze(value);

        return value;
    }

    return value;
}

/**
 * Serializes `state` for equality comparisons that must catch structural
 * drift (extra/missing/reordered-but-different keys) the way a save file
 * round-trip would, rather than comparing live object references.
 */
function snapshot(state: State): string {
    return JSON.stringify(state);
}

test('should throw when mutating a property that deepFreeze froze on a nested object', () => {
    const frozen = deepFreeze({ outer: { inner: 1 } });

    assert.throws(() => {
        frozen.outer.inner = 2;
    }, TypeError);
});

test('should leave a deepFreeze-frozen array element unchanged after a mutation attempt', () => {
    const frozen = deepFreeze({ items: [1, 2, 3] });

    assert.throws(() => {
        frozen.items.push(4);
    }, TypeError);
    assert.deepEqual(frozen.items, [1, 2, 3]);
});

test('should advance tick by 1 when reducing a WAIT action with n: 1 over initialState(SEED)', () => {
    const state = deepFreeze(initialState(SEED));

    const next = reduce(state, { type: 'WAIT', n: 1 });

    assert.equal(next.tick, 1);
    assert.notEqual(snapshot(next), snapshot(state));
});

test('should never mutate its input state across accepted, rejected, and unknown actions', () => {
    const state = deepFreeze(initialState(SEED));
    const before = snapshot(state);

    reduce(state, { type: 'WAIT', n: 3 });
    reduce(state, { type: 'WAIT', n: -1 });
    reduce(state, { type: 'NOPE' });

    assert.equal(snapshot(state), before);
});

test('should return the input state by identical reference for unknown or malformed-shape actions', () => {
    const cases: unknown[] = [
        { type: 'NOPE' },
        null,
        undefined,
        42,
        'WAIT',
        [],
        {},
        { type: 42 },
        { type: 'toString' },
        { type: '__proto__' },
        { type: 'constructor' },
    ];

    for (const action of cases) {
        const state = deepFreeze(initialState(SEED));

        assert.equal(reduce(state, action), state, `expected identical reference for action ${JSON.stringify(action)}`);
    }
});

for (const n of [0, 1, 7, 1000]) {
    test(`should advance tick by exactly ${n} and clear lastRejection when reducing a WAIT action with n: ${n}`, () => {
        const state = deepFreeze(initialState(SEED));

        const next = reduce(state, { type: 'WAIT', n });

        assert.equal(next.tick, state.tick + n);
        assert.equal(next.lastRejection, null);
    });
}

test('should round-trip the result of an accepted WAIT action through JSON with no loss', () => {
    const state = deepFreeze(initialState(SEED));

    const next = reduce(state, { type: 'WAIT', n: 5 });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(next)), next);
    assert.deepStrictEqual(findUndefined(next), []);
});

test('should reject a WAIT action with n: -1 as INVALID_ARGUMENT without advancing tick', () => {
    const state = deepFreeze(initialState(SEED));
    const action = { type: 'WAIT', n: -1 };

    const next = reduce(state, action);

    assert.equal(next.tick, state.tick);
    assert.notEqual(next, state);
    assert.equal(next.lastRejection?.reason, 'INVALID_ARGUMENT');
    assert.deepStrictEqual(next.lastRejection?.action, { type: 'WAIT' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(next)), next);
    assert.deepStrictEqual(findUndefined(next), []);
});

test('should clear lastRejection on the next accepted action after a rejection', () => {
    const state = deepFreeze(initialState(SEED));

    const rejected = reduce(state, { type: 'WAIT', n: -1 });

    assert.notEqual(rejected.lastRejection, null);

    const next = reduce(deepFreeze(rejected), { type: 'WAIT', n: 1 });

    assert.equal(next.lastRejection, null);
    assert.equal(next.tick, rejected.tick + 1);
});

const malformedWaitNs: unknown[] = [1.5, NaN, Infinity, '3', true, null, undefined, 1n];

for (const n of malformedWaitNs) {
    test(`should reject a WAIT action with n: ${String(n)} as INVALID_ARGUMENT without advancing tick`, () => {
        const state = deepFreeze(initialState(SEED));
        const action = { type: 'WAIT', n };

        const next = reduce(state, action);

        assert.equal(next.tick, state.tick, `tick should not advance for n: ${String(n)}`);
        assert.equal(next.lastRejection?.reason, 'INVALID_ARGUMENT', `expected INVALID_ARGUMENT for n: ${String(n)}`);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(next)), next, `should round-trip for n: ${String(n)}`);
        assert.deepStrictEqual(findUndefined(next), [], `no undefined for n: ${String(n)}`);
    });
}

test('should reject a WAIT action with a missing n as INVALID_ARGUMENT without advancing tick', () => {
    const state = deepFreeze(initialState(SEED));
    const action = { type: 'WAIT' };

    const next = reduce(state, action);

    assert.equal(next.tick, state.tick, 'tick should not advance when n is missing');
    assert.equal(next.lastRejection?.reason, 'INVALID_ARGUMENT', 'expected INVALID_ARGUMENT when n is missing');
});

test('should reject a cyclic WAIT action without the cycle reaching lastRejection', () => {
    const state = deepFreeze(initialState(SEED));
    const action: Record<string, unknown> = { type: 'WAIT', n: -1 };
    action.self = action;

    const next = reduce(state, action);

    assert.equal(next.tick, state.tick);
    assert.equal(next.lastRejection?.reason, 'INVALID_ARGUMENT');
    assert.deepStrictEqual(next.lastRejection?.action, { type: 'WAIT' });
    assert.doesNotThrow(() => JSON.stringify(next));
});

test('should strip a stray property from a WAIT action via parse normalization', () => {
    const state = deepFreeze(initialState(SEED));
    const action = { type: 'WAIT', n: 2, sneaky: 'x' };

    const next = reduce(state, action);

    assert.equal(next.tick, state.tick + 2);
    assert.ok(!JSON.stringify(next).includes('sneaky'));
    assert.deepStrictEqual(ACTIONS.WAIT?.parse({ type: 'WAIT', n: 2, sneaky: 'x' }), { type: 'WAIT', n: 2 });

    const rejected = reduce(state, { type: 'WAIT', n: -1, sneaky: 'x' });

    assert.ok(!JSON.stringify(rejected).includes('sneaky'));
});

test('should accumulate tick to 10 when folding a sequence of WAIT actions [1, 2, 3, 0, 4]', () => {
    const waits = [1, 2, 3, 0, 4];

    const final = waits.reduce(
        (state, n) => reduce(state, { type: 'WAIT', n }),
        initialState(SEED),
    );

    assert.equal(final.tick, 10);
});

test('should discard a handler write to tick and advance by the driver-computed duration instead', () => {
    const state = deepFreeze(initialState(SEED));
    const TEST_TICK_TYPE = '__TEST_TICK__';

    ACTIONS[TEST_TICK_TYPE] = defineAction<{ type: '__TEST_TICK__' }>({
        parse: () => ({ type: '__TEST_TICK__' }),
        duration: () => 5,
        apply: (currentState) => ({ ...currentState, tick: 9999 }),
    });

    try {
        const next = reduce(state, { type: TEST_TICK_TYPE });

        assert.equal(next.tick, state.tick + 5);
        assert.notEqual(next.tick, 9999);
    } finally {
        delete ACTIONS[TEST_TICK_TYPE];
    }
});

test('should compute duration from the pre-action state, not the post-apply state', () => {
    const state = deepFreeze(initialState(SEED));
    const TEST_DURATION_TYPE = '__TEST_DURATION__';

    ACTIONS[TEST_DURATION_TYPE] = defineAction<{ type: '__TEST_DURATION__' }>({
        parse: () => ({ type: '__TEST_DURATION__' }),
        duration: (currentState) => currentState.credits / 100,
        apply: (currentState) => ({ ...currentState, credits: 0 }),
    });

    try {
        const next = reduce(state, { type: TEST_DURATION_TYPE });

        assert.equal(next.tick, state.tick + state.credits / 100);
        assert.notEqual(next.tick, state.tick + next.credits / 100);
    } finally {
        delete ACTIONS[TEST_DURATION_TYPE];
    }
});

/**
 * One sample action per registered type, used below to prove `durationOf`
 * agrees with the tick delta `reduce` actually produces. Keyed by
 * `action.type` so M0-04+ can append a sample alongside each new registry
 * entry without touching the assertion itself.
 */
const SAMPLE_ACTIONS: Record<string, unknown> = {
    WAIT: { type: 'WAIT', n: 4 },
};

test('should have durationOf return null for unknown or malformed actions', () => {
    const cases: unknown[] = [
        { type: 'NOPE' },
        null,
        42,
        [],
        {},
        { type: 'WAIT', n: -1 },
    ];

    for (const action of cases) {
        const state = deepFreeze(initialState(SEED));

        assert.equal(durationOf(state, action), null, `expected null for action ${JSON.stringify(action)}`);
    }
});

test('should have every ACTIONS entry fully specify parse, duration, and apply as functions', () => {
    for (const [type, spec] of Object.entries(ACTIONS)) {
        for (const member of ['parse', 'duration', 'apply'] as const) {
            assert.equal(
                typeof spec[member],
                'function',
                `ACTIONS['${type}'] is missing a function '${member}' member`,
            );
        }
    }
});

test('should have durationOf agree with the tick delta reduce actually produces, for every registered action type', () => {
    for (const type of Object.keys(ACTIONS)) {
        assert.ok(
            Object.hasOwn(SAMPLE_ACTIONS, type),
            `no sample action registered for type '${type}' in SAMPLE_ACTIONS - add one so this test covers it`,
        );

        const sample = SAMPLE_ACTIONS[type];
        const state = deepFreeze(initialState(SEED));
        const predicted = durationOf(state, sample);
        const next = reduce(state, sample);

        assert.equal(next.tick - state.tick, predicted, `durationOf(${type}) disagreed with the observed reduce tick delta`);
    }
});

test('should have a null prototype and no inherited toString on the ACTIONS registry', () => {
    assert.equal(Object.getPrototypeOf(ACTIONS), null);
    assert.equal(ACTIONS['toString'], undefined);
});

test('should ignore a WAIT action whose n getter throws instead of propagating the throw', () => {
    const state = deepFreeze(initialState(SEED));
    const action: Record<string, unknown> = { type: 'WAIT' };

    Object.defineProperty(action, 'n', {
        get() {
            throw new Error('getter boom');
        },
        enumerable: true,
    });

    const next = reduce(state, action);

    assert.equal(next, state, 'a throwing getter should be treated like malformed input: identical reference');
});

test('should have durationOf return null for a WAIT action whose n getter throws instead of propagating the throw', () => {
    const state = deepFreeze(initialState(SEED));
    const action: Record<string, unknown> = { type: 'WAIT' };

    Object.defineProperty(action, 'n', {
        get() {
            throw new Error('getter boom');
        },
        enumerable: true,
    });

    assert.equal(durationOf(state, action), null);
});
