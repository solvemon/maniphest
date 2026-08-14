import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEMS } from './map.ts';

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
