import { mix64, toFloat53 } from './splitmix64.ts';

/** A seeded, deterministic source of randomness. */
export interface Rng {
    /** Returns a float in the range `[0, 1)`. */
    float(): number;

    /** Returns an integer in the range `[min, max]`, inclusive on both ends. */
    int(min: number, max: number): number;

    /**
     * Returns `true` with probability `p`.
     *
     * `p <= 0` always returns `false`; `p >= 1` always returns `true`.
     */
    chance(p: number): boolean;

    /** Returns a uniformly random element of `items`. Throws on empty input. */
    pick<T>(items: readonly T[]): T;
}

/** Serializable state of an {@link Rng}; matches the save format. */
export interface RngState {
    seed: number;
    counter: number;
}

/** An {@link Rng} whose internal state can be captured and restored. */
export interface EventRng extends Rng {
    /** Captures the current state, suitable for persisting to a save. */
    snapshot(): RngState;
}

/**
 * Creates a counter-based {@link Rng} seeded from `base`.
 *
 * Each draw combines `base` with the current counter value via two rounds
 * of `mix64`, then advances the counter. The returned object exposes a
 * `counter()` accessor for inspecting the current draw count.
 */
export function makeRng(base: bigint, startCounter = 0): Rng & { counter(): number } {

    let counter = startCounter;

    function nextUint64(): bigint {
        return mix64(base ^ mix64(BigInt(counter++)));
    }

    function float(): number {
        return toFloat53(nextUint64());
    }

    /**
     * Uses rejection sampling against `nextUint64()` to avoid modulo bias:
     * draws that would skew the distribution (those falling above the
     * largest multiple of `range` that fits in 64 bits) are discarded and
     * redrawn.
     */
    function int(min: number, max: number): number {
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
            throw new RangeError(
                `int(min, max) requires safe integers with min <= max; received min=${min}, max=${max}`,
            );
        }

        const range = BigInt(max - min + 1);
        const limit = (2n ** 64n / range) * range;

        let raw = nextUint64();
        while (raw >= limit) {
            raw = nextUint64();
        }

        return min + Number(raw % range);
    }

    /**
     * Returns `true` with probability `p`.
     *
     * `p <= 0` (including `NaN`) always returns `false`, and `p >= 1`
     * always returns `true`. These short-circuit branches are a
     * deliberate, contract-level property: they consume NO draws, so
     * callers can rely on the draw counter being unaffected when `p`
     * falls outside `(0, 1)`. Only the non-degenerate case draws a
     * single value via `float()`.
     */
    function chance(p: number): boolean {
        if (p <= 0 || Number.isNaN(p)) {
            return false;
        }

        if (p >= 1) {
            return true;
        }

        return float() < p;
    }

    function pick<T>(items: readonly T[]): T {
        if (items.length === 0) {
            throw new RangeError('pick(items) requires a non-empty array');
        }

        const index = int(0, items.length - 1);

        // Bounded by the `int(0, items.length - 1)` call above.
        return items[index]!;
    }

    return {
        float,
        int,
        chance,
        pick,

        counter(): number {
            return counter;
        },
    };
}
