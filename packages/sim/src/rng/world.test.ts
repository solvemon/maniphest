import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldRng } from './world.ts';
import type { WorldDomain } from './world.ts';
import type { Rng } from './rng.ts';

/**
 * Shared fixtures and helpers for `world.test.ts`. Kept at the top of the
 * file so later tests (interleaving, decorrelation, distribution, edges)
 * can be appended below and reuse them without duplicating setup.
 */

const WORLD_SEED = 424242;
const SHUFFLE_SEED = 971;

const WORLD_DOMAINS: readonly WorldDomain[] =
    ['sector', 'system', 'planets', 'pirates', 'hazard', 'depot', 'find'];

const SAMPLE_COORD_VALUES: readonly number[] = [
    0, 1, -1, 2, -2, 5, -5, 17, -17, 100, -100, 12345, -12345,
];

const MAX_ARITY = 4;
const TUPLES_PER_ARITY = 18;

interface WorldKey {
    domain: WorldDomain;
    coords: number[];
}

/**
 * Builds a fixed, deterministic set of `{ domain, coords }` keys spanning
 * every {@link WorldDomain}, coord arities from 0 through {@link MAX_ARITY},
 * and a mix of positive, negative, and zero coord values.
 */
function buildKeys(): WorldKey[] {
    const keys: WorldKey[] = [];

    for (const domain of WORLD_DOMAINS) {
        keys.push({ domain, coords: [] });

        for (let arity = 1; arity <= MAX_ARITY; arity++) {
            for (let variant = 0; variant < TUPLES_PER_ARITY; variant++) {
                const coords: number[] = [];

                for (let position = 0; position < arity; position++) {
                    const index = (variant + position) % SAMPLE_COORD_VALUES.length;
                    coords.push(SAMPLE_COORD_VALUES[index]!);
                }

                keys.push({ domain, coords });
            }
        }
    }

    return keys;
}

/** Stable string form of a {@link WorldKey}, suitable as a Map key. */
function keyToString(key: WorldKey): string {
    return JSON.stringify(key);
}

/**
 * Fisher-Yates shuffle driven entirely by a seeded {@link Rng}. `Math.random`
 * is banned in this package, so every reordering in these tests must be
 * produced by a deterministic, seeded generator instead.
 */
function fisherYatesShuffle<T>(items: readonly T[], rng: Rng): T[] {
    const shuffled = [...items];

    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const temp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = temp;
    }

    return shuffled;
}

/**
 * Pearson correlation coefficient between two equal-length numeric samples.
 * Used to assert that `float()` draws from different {@link WorldDomain}
 * tags at identical coordinates are statistically uncorrelated.
 */
function pearson(a: number[], b: number[]): number {
    assert.equal(a.length, b.length, 'pearson(a, b) requires equal-length samples');

    const n = a.length;
    const meanA = a.reduce((sum, value) => sum + value, 0) / n;
    const meanB = b.reduce((sum, value) => sum + value, 0) / n;

    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;

    for (let i = 0; i < n; i++) {
        const deviationA = a[i]! - meanA;
        const deviationB = b[i]! - meanB;

        covariance += deviationA * deviationB;
        varianceA += deviationA * deviationA;
        varianceB += deviationB * deviationB;
    }

    return covariance / Math.sqrt(varianceA * varianceB);
}

test('should return identical values for identical (domain, coords) regardless of call order', () => {
    const keys = buildKeys();
    assert.ok(keys.length >= 500, `expected at least 500 keys, got ${keys.length}`);

    const recorded = new Map<string, number>();
    for (const key of keys) {
        recorded.set(keyToString(key), worldRng(WORLD_SEED, key.domain, ...key.coords).float());
    }

    // Shuffle with an Rng seeded independently of the one used to derive
    // the recorded values above, so the reordering itself is deterministic
    // without leaking into the values being compared.
    const shuffleRng = worldRng(SHUFFLE_SEED, 'find', 0);
    const shuffled = fisherYatesShuffle(keys, shuffleRng);

    assert.notDeepEqual(
        shuffled.map(keyToString),
        keys.map(keyToString),
        'expected the shuffle to actually reorder the keys',
    );

    const requeried = new Map<string, number>();
    for (const key of shuffled) {
        requeried.set(keyToString(key), worldRng(WORLD_SEED, key.domain, ...key.coords).float());
    }

    assert.deepEqual(requeried, recorded);
});

test('should not perturb each other when two worldRng generators are drawn interleaved', () => {
    const DRAW_COUNT = 20;

    const keyA: WorldKey = { domain: 'sector', coords: [12, -4] };
    const keyB: WorldKey = { domain: 'pirates', coords: [7] };

    const interleavedA = worldRng(WORLD_SEED, keyA.domain, ...keyA.coords);
    const interleavedB = worldRng(WORLD_SEED, keyB.domain, ...keyB.coords);

    const collectedA: number[] = [];
    const collectedB: number[] = [];

    for (let i = 0; i < DRAW_COUNT; i++) {
        collectedA.push(interleavedA.float());
        collectedB.push(interleavedB.float());
    }

    const isolatedA = worldRng(WORLD_SEED, keyA.domain, ...keyA.coords);
    const isolatedB = worldRng(WORLD_SEED, keyB.domain, ...keyB.coords);

    const expectedA: number[] = [];
    const expectedB: number[] = [];

    for (let i = 0; i < DRAW_COUNT; i++) {
        expectedA.push(isolatedA.float());
    }

    for (let i = 0; i < DRAW_COUNT; i++) {
        expectedB.push(isolatedB.float());
    }

    assert.deepEqual(collectedA, expectedA);
    assert.deepEqual(collectedB, expectedB);
});

test('should decorrelate float() draws across different domains at identical coordinates', () => {
    const POINT_COUNT = 2000;
    const COORD_RANGE = 1_000_000;
    const COORD_SEED = 135791;

    const coordRng = worldRng(COORD_SEED, 'find', 1);
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < POINT_COUNT; i++) {
        points.push({
            x: coordRng.int(-COORD_RANGE, COORD_RANGE),
            y: coordRng.int(-COORD_RANGE, COORD_RANGE),
        });
    }

    const valuesByDomain = new Map<WorldDomain, number[]>();
    for (const domain of WORLD_DOMAINS) {
        valuesByDomain.set(
            domain,
            points.map(({ x, y }) => worldRng(WORLD_SEED, domain, x, y).float()),
        );
    }

    for (let i = 0; i < WORLD_DOMAINS.length; i++) {
        for (let j = i + 1; j < WORLD_DOMAINS.length; j++) {
            const domainA = WORLD_DOMAINS[i]!;
            const domainB = WORLD_DOMAINS[j]!;
            const valuesA = valuesByDomain.get(domainA)!;
            const valuesB = valuesByDomain.get(domainB)!;

            const r = pearson(valuesA, valuesB);
            assert.ok(
                Math.abs(r) < 0.1,
                `expected |correlation| < 0.1 between '${domainA}' and '${domainB}', got ${r}`,
            );

            for (let k = 0; k < valuesA.length; k++) {
                assert.notEqual(
                    valuesA[k],
                    valuesB[k],
                    `expected '${domainA}' and '${domainB}' to differ at point ${k} ` +
                        `(x=${points[k]!.x}, y=${points[k]!.y})`,
                );
            }
        }
    }
});

/**
 * Reconstructs the raw 64-bit hash bits underlying a `worldRng(...).float()`
 * draw by inverting `toFloat53`'s bit selection: `float()` returns the top
 * 53 bits of the accumulator as a `[0, 1)` double, so multiplying back by
 * `2 ** 53` recovers those 53 bits exactly (the low 11 bits are lost, but
 * that's an acceptable trade for exercising the real, shipped `worldRng`
 * path rather than a duplicated re-implementation of its mixing chain).
 */
function worldHashBits(seed: number, domain: WorldDomain, ...coords: number[]): bigint {
    const value = worldRng(seed, domain, ...coords).float();

    return BigInt(Math.round(value * 2 ** 53));
}

/** Counts set bits in a non-negative bigint. */
function popcount64(value: bigint): number {
    let count = 0;
    let remaining = value;

    while (remaining > 0n) {
        count += Number(remaining & 1n);
        remaining >>= 1n;
    }

    return count;
}

test('should approximate a uniform distribution across 16 buckets under a chi-square test', () => {
    const POINT_COUNT = 20_000;
    const BUCKET_COUNT = 16;
    const CHI_SQUARE_CRITICAL_15DF_999 = 37.697;
    const COORD_RANGE = 1_000_000;
    const COORD_SEED = 246810;

    // `x` runs sequentially over POINT_COUNT distinct values, which alone
    // guarantees every (x, y) pair is distinct regardless of `y`.
    const coordRng = worldRng(COORD_SEED, 'find', 2);
    const buckets = new Array<number>(BUCKET_COUNT).fill(0);

    for (let x = 0; x < POINT_COUNT; x++) {
        const y = coordRng.int(-COORD_RANGE, COORD_RANGE);
        const value = worldRng(WORLD_SEED, 'sector', x, y).float();

        const bucketIndex = Math.min(BUCKET_COUNT - 1, Math.floor(value * BUCKET_COUNT));
        buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + 1;
    }

    const expectedPerBucket = POINT_COUNT / BUCKET_COUNT;
    let chiSquare = 0;
    for (const observed of buckets) {
        chiSquare += (observed - expectedPerBucket) ** 2 / expectedPerBucket;
    }

    assert.ok(
        chiSquare < CHI_SQUARE_CRITICAL_15DF_999,
        `expected chi-square statistic below the 99.9% critical value for 15 df ` +
            `(${CHI_SQUARE_CRITICAL_15DF_999}), got ${chiSquare}`,
    );
});

test('should flip roughly half the output bits when the x coordinate is incremented by 1', () => {
    const SAMPLE_COUNT = 500;
    const COORD_RANGE = 1_000_000;
    const COORD_SEED = 864213;

    // Bounds are the same 31.25%-68.75% band the previous 64-bit version of
    // this test used, rescaled to the 53 mantissa bits `worldHashBits`
    // recovers from `float()` (53 * 0.3125 = 16.5625, 53 * 0.6875 = 36.4375).
    const MIN_AVERAGE_FLIPPED_BITS = 17;
    const MAX_AVERAGE_FLIPPED_BITS = 36;

    const coordRng = worldRng(COORD_SEED, 'find', 3);
    let totalFlippedBits = 0;

    for (let i = 0; i < SAMPLE_COUNT; i++) {
        const x = coordRng.int(-COORD_RANGE, COORD_RANGE);
        const y = coordRng.int(-COORD_RANGE, COORD_RANGE);

        const hashA = worldHashBits(WORLD_SEED, 'sector', x, y);
        const hashB = worldHashBits(WORLD_SEED, 'sector', x + 1, y);

        totalFlippedBits += popcount64(hashA ^ hashB);
    }

    const averageFlippedBits = totalFlippedBits / SAMPLE_COUNT;
    assert.ok(
        averageFlippedBits >= MIN_AVERAGE_FLIPPED_BITS && averageFlippedBits <= MAX_AVERAGE_FLIPPED_BITS,
        `expected average flipped bits in [${MIN_AVERAGE_FLIPPED_BITS}, ${MAX_AVERAGE_FLIPPED_BITS}] ` +
            `of 53, got ${averageFlippedBits}`,
    );
});

test('should be stable across repeated calls with negative coords and differ from their positive twins', () => {
    const negativeFirst = worldRng(WORLD_SEED, 'sector', -4, -9).float();
    const negativeSecond = worldRng(WORLD_SEED, 'sector', -4, -9).float();
    const positive = worldRng(WORLD_SEED, 'sector', 4, 9).float();

    assert.equal(negativeFirst, negativeSecond);
    assert.notEqual(negativeFirst, positive);
});

test('should treat differing coord arity as a different world even when leading coords match', () => {
    const shortArity = worldRng(WORLD_SEED, 'sector', 12, -4).float();
    const longArity = worldRng(WORLD_SEED, 'sector', 12, -4, 0).float();

    assert.notEqual(shortArity, longArity);
});

test('should return a usable, stable Rng when called with zero coords', () => {
    const first = worldRng(WORLD_SEED, 'sector');
    const second = worldRng(WORLD_SEED, 'sector');

    assert.equal(typeof first.float(), 'number');
    assert.equal(second.float(), worldRng(WORLD_SEED, 'sector').float());
});

test('should throw RangeError for non-integer or non-finite coords', () => {
    const invalidCoords = [1.5, NaN, Infinity, -Infinity, 2 ** 53];

    for (const coord of invalidCoords) {
        assert.throws(
            () => worldRng(WORLD_SEED, 'sector', coord),
            RangeError,
            `expected worldRng to throw RangeError for coord ${coord}`,
        );
    }
});

test('should carry no hidden memo state between two worldRng calls with identical args', () => {
    const DRAW_COUNT = 50;

    const first = worldRng(WORLD_SEED, 'sector', 12, -4);
    const second = worldRng(WORLD_SEED, 'sector', 12, -4);

    const firstSequence: number[] = [];
    const secondSequence: number[] = [];

    for (let i = 0; i < DRAW_COUNT; i++) {
        firstSequence.push(first.float());
    }

    for (let i = 0; i < DRAW_COUNT; i++) {
        secondSequence.push(second.float());
    }

    assert.deepEqual(firstSequence, secondSequence);
});

test('should match pinned golden vectors for the composed worldRng derivation', () => {
    // Hardcoded literal expectations, generated once by running the actual
    // implementation (not invented) and pinned here so the mixing chain in
    // world.ts (and the per-draw combine in rng.ts it delegates to) cannot
    // silently change while every other test in this file - being either
    // intra-run self-consistency or a statistical property - keeps passing.
    // The matrix spans every WorldDomain-adjacent case that matters: zero,
    // one, two, and three coords, and both positive and negative values.
    const goldenVectors: Array<{ domain: WorldDomain; coords: number[]; expected: number }> = [
        { domain: 'sector', coords: [], expected: 0.6259907259043314 },
        { domain: 'system', coords: [12], expected: 0.5432798075063685 },
        { domain: 'sector', coords: [12, -4], expected: 0.043049784366923194 },
        { domain: 'pirates', coords: [7, -8, 9], expected: 0.32901143786077813 },
        { domain: 'hazard', coords: [-1, -2, -3], expected: 0.7808157742013884 },
        { domain: 'depot', coords: [0, 0], expected: 0.6227317324911693 },
        { domain: 'find', coords: [-100000, 100000, 42], expected: 0.5617344758631738 },
        { domain: 'planets', coords: [1], expected: 0.6718059713670717 },
        { domain: 'system', coords: [], expected: 0.34129480760415887 },
    ];

    for (const { domain, coords, expected } of goldenVectors) {
        const actual = worldRng(WORLD_SEED, domain, ...coords).float();
        assert.equal(
            actual,
            expected,
            `expected worldRng(${WORLD_SEED}, '${domain}', ${coords.join(', ')}).float() ` +
                `to equal pinned golden value ${expected}, got ${actual}`,
        );
    }
});
