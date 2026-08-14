import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME_SYSTEM_ID, SYSTEMS, systemById } from './map.ts';

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
