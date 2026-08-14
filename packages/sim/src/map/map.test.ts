import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceBetween, HOME_SYSTEM_ID, SYSTEMS, systemById } from './map.ts';

test('should hardcode exactly two systems', () => {
    assert.equal(SYSTEMS.length, 2);
});

test('should give every system a non-empty id and name', () => {
    for (const system of SYSTEMS) {
        assert.equal(typeof system.id, 'string');
        assert.ok(system.id.length > 0);
        assert.equal(typeof system.name, 'string');
        assert.ok(system.name.length > 0);
    }
});

test('should give the two systems distinct ids', () => {
    assert.notEqual(SYSTEMS[0]!.id, SYSTEMS[1]!.id);
});

test('should set the home system id to the first system id', () => {
    assert.equal(HOME_SYSTEM_ID, SYSTEMS[0]!.id);
});

test('should resolve the home system id to a system', () => {
    const system = systemById(HOME_SYSTEM_ID);
    assert.notEqual(system, null);
    assert.equal(system!.id, HOME_SYSTEM_ID);
});

test('should give every ordered pair of distinct systems a positive integer distance', () => {
    for (const a of SYSTEMS) {
        for (const b of SYSTEMS) {
            if (a.id === b.id) {
                continue;
            }
            const distance = distanceBetween(a.id, b.id);
            assert.ok(
                Number.isSafeInteger(distance) && distance! > 0,
                `distance from '${a.id}' to '${b.id}' should be a positive safe integer, got ${distance}`,
            );
        }
    }
});

test('should give every ordered pair of systems a symmetric distance', () => {
    for (const a of SYSTEMS) {
        for (const b of SYSTEMS) {
            assert.equal(
                distanceBetween(a.id, b.id),
                distanceBetween(b.id, a.id),
                `distance from '${a.id}' to '${b.id}' should equal distance from '${b.id}' to '${a.id}'`,
            );
        }
    }
});

test('should give a zero distance from a system to itself', () => {
    for (const system of SYSTEMS) {
        assert.equal(distanceBetween(system.id, system.id), 0);
    }
});

test('should give a null distance when the origin system id is unknown', () => {
    assert.equal(distanceBetween('nope', 'sol'), null);
});

test('should give a null distance when the destination system id is unknown', () => {
    assert.equal(distanceBetween('sol', 'nope'), null);
});

test('should give a null distance when both system ids are unknown', () => {
    assert.equal(distanceBetween('nope', 'nah'), null);
});

test('should resolve unknown and prototype-named system ids to null', () => {
    for (const id of ['nope', 'toString', '__proto__', 'constructor']) {
        assert.equal(systemById(id), null, `systemById('${id}') should be null`);
    }
});
