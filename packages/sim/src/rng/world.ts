import { mix64, hashString, toUint64 } from './splitmix64.ts';
import { makeRng } from './rng.ts';
import type { Rng } from './rng.ts';

/**
 * Domain tag identifying which subsystem a world-hashed draw belongs to.
 *
 * Deliberately a literal union rather than an `enum`: `erasableSyntaxOnly`
 * forbids enums, and a literal union turns a typo'd domain tag into a
 * compile error instead of a silently divergent galaxy.
 */
export type WorldDomain =
    | 'sector' | 'system' | 'planets' | 'pirates' | 'hazard' | 'depot' | 'find';

/**
 * Derives a deterministic {@link Rng} from a world seed, a domain tag, and
 * an arbitrary sequence of integer coordinates.
 *
 * Fully stateless: the returned generator depends only on the arguments
 * given here, not on call order, prior calls, or any shared counter. Calling
 * `worldRng` twice with identical arguments yields generators that produce
 * identical draw sequences.
 *
 * Coordinates may be negative — each is folded via {@link toUint64}, which
 * wraps through `BigInt.asUintN(64, ...)`, so e.g. sector index `-4` mixes
 * in as its unsigned 64-bit two's-complement representation rather than
 * throwing or colliding with a differently-signed value.
 *
 * The coordinate *count* is folded in last, so arity is part of the key:
 * `worldRng(seed, 'sector', 12, -4)` and `worldRng(seed, 'sector', 12, -4, 0)`
 * are distinct worlds even though the latter's leading coordinates match
 * the former's exactly.
 *
 * @throws {RangeError} if any coord is not a safe integer (`NaN`,
 * `Infinity`, `-Infinity`, a fractional value, or a magnitude beyond
 * `2^53`).
 */
export function worldRng(seed: number, domain: WorldDomain, ...coords: number[]): Rng {

    // Validate every coord eagerly, before any mixing. A NaN or fractional
    // coord that slipped through here would still mix into a valid-looking
    // acc and produce a valid-looking Rng — a silent corruption that would
    // quietly poison a galaxy while it kept rendering. Crashing loudly here
    // beats that.
    for (let i = 0; i < coords.length; i++) {
        const coord = coords[i]!;

        if (!Number.isSafeInteger(coord)) {
            throw new RangeError(
                `worldRng('${domain}'): coord at index ${i} must be a safe integer; received ${coord}`,
            );
        }
    }

    let acc = mix64(toUint64(seed));
    acc = mix64(acc ^ hashString(domain));

    for (const coord of coords) {
        acc = mix64(acc ^ toUint64(coord));
    }

    acc = mix64(acc ^ toUint64(coords.length));

    return makeRng(acc);
}
