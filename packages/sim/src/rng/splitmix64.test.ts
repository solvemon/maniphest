import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mix64, toFloat53, hashString } from './splitmix64.ts';

const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;
const MASK_64 = (1n << 64n) - 1n;

test('should match the pinned splitmix64 reference vectors for state 0', () => {
    const expected = [
        0xe220a8397b1dcdafn,
        0x6e789e6aa1b965f4n,
        0x06c45d188009454fn,
        0xf88bb8a8724c81ecn,
        0x1b39896a51a8749bn,
    ];
    const actual: bigint[] = [];
    let state = 0n;

    for (let i = 0; i < expected.length; i++) {
        actual.push(mix64(state));
        state = (state + GOLDEN_GAMMA) & MASK_64;
    }

    assert.deepEqual(actual, expected);
});

test('should produce toFloat53 values within [0, 1) across 10k derived values', () => {
    let state = 0n;

    for (let i = 0; i < 10_000; i++) {
        state = (state + GOLDEN_GAMMA) & MASK_64;
        const value = toFloat53(mix64(state));
        assert.ok(value >= 0);
        assert.ok(value < 1);
    }
});

test('should map toFloat53(0n) to exactly 0', () => {
    assert.equal(toFloat53(0n), 0);
});

test('should hash strings stably across calls', () => {
    assert.equal(hashString('sector'), hashString('sector'));
});

test('should hash strings case-sensitively', () => {
    assert.notEqual(hashString('sector'), hashString('Sector'));
});

test('should hash the empty string differently from a non-empty string', () => {
    assert.notEqual(hashString(''), hashString('a'));
});

test('should match pinned golden hashString values', () => {
    assert.equal(hashString('sector'), 16021512719813936079n);
    assert.equal(hashString('system'), 13814046143737672956n);
    assert.equal(hashString('planets'), 2183907289433885728n);
    assert.equal(hashString(''), 14695981039346656037n);
});
