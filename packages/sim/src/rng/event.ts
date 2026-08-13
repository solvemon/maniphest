import { mix64, toUint64 } from './splitmix64.ts';
import { makeRng } from './rng.ts';
import type { EventRng, RngState } from './rng.ts';

/**
 * Creates an {@link EventRng} that resumes an event stream from `state`.
 *
 * Resume is BY CONSTRUCTION, not replay: each draw is a pure function of
 * `(seed, counter)`, so resuming at `state.counter` is O(1) — there is no
 * fast-forward loop that redraws the first `state.counter` values. Resuming
 * at counter 7 and drawing once produces exactly the value a fresh stream
 * would produce on its 8th draw.
 *
 * Reducer call-site contract: construct the generator from the persisted
 * state, draw from it, then persist the new state via `snapshot()` — never
 * hold on to the generator across a reducer boundary.
 *
 * ```ts
 * const rng = eventRng(state.rng);
 * const hit = rng.chance(0.3);
 * return { ...state, rng: rng.snapshot() };
 * ```
 *
 * @throws {RangeError} if `state.seed` or `state.counter` is not a safe
 * integer, or if `state.counter` is negative.
 */
export function eventRng(state: RngState): EventRng {

    if (!Number.isSafeInteger(state.seed)) {
        throw new RangeError(
            `eventRng(state): state.seed must be a safe integer; received ${state.seed}`,
        );
    }

    if (!Number.isSafeInteger(state.counter) || state.counter < 0) {
        throw new RangeError(
            `eventRng(state): state.counter must be a non-negative safe integer; received ${state.counter}`,
        );
    }

    const base = mix64(toUint64(state.seed));
    const delegate = makeRng(base, state.counter);

    return {
        float: delegate.float,
        int: delegate.int,
        chance: delegate.chance,
        pick: delegate.pick,

        snapshot(): RngState {
            return { seed: state.seed, counter: delegate.counter() };
        },
    };
}
