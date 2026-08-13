const M = (1n << 64n) - 1n;

export function mix64(state: bigint): bigint {
    let z = (state + 0x9e3779b97f4a7c15n) & M;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;

    return z ^ (z >> 31n);
}

/**
 * Converts a 64-bit state value to a double in the range `[0, 1)`.
 *
 * Uses the top 53 bits of the 64-bit value to fill the full double
 * mantissa, avoiding the precision loss of a naive `Number(z) / 2**64`
 * conversion.
 */
export function toFloat53(z: bigint): number {
    return Number(BigInt.asUintN(64, z) >> 11n) / 2 ** 53;
}

/** Wraps `n` to an unsigned 64-bit bigint, accepting either a number or bigint. */
export function toUint64(n: number | bigint): bigint {
    return BigInt.asUintN(64, BigInt(n));
}

export function hashString(s: string): bigint {
    const offsetBasis = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    let hash = offsetBasis;

    for (let i = 0; i < s.length; i++) {
        hash ^= BigInt(s.charCodeAt(i));
        hash = (hash * prime) & M;
    }

    return hash;
}
