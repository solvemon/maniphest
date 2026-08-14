/**
 * Shared test-only helpers for the `state` slice.
 *
 * This file intentionally does NOT end in `.test.ts`: the workspace test
 * runner globs `src/**\/*.test.ts` (see `packages/sim/package.json`), and a
 * file matching that glob is executed as its own test file. `findUndefined`
 * below is imported by both `state.test.ts` and `reduce.test.ts`; if it
 * lived in a `*.test.ts` file, importing it from a sibling test file would
 * cause its own `test()` registrations to run twice (once as itself, once
 * as a side effect of being imported as a module) - Node's test runner has
 * no notion of a "module that happens to also be a test file" and simply
 * re-executes every top-level `test()` call it encounters when the module
 * is loaded, however it's reached.
 *
 * Despite being test-only support code, this file is NOT a `*.test.ts` file,
 * so it is not excluded by `packages/sim/tsconfig.json`'s
 * `"exclude": ["src/**\/*.test.ts"]` and would otherwise be compiled into
 * `dist/` as shipped package output. `tsconfig.json` additionally excludes
 * `src/**\/test-helpers.ts` by name to keep this test-only helper out of the
 * built package while still letting it be type-checked (transitively, via
 * the test files that import it) under `tsconfig.test.json`.
 */

/**
 * Recursively walks `value`, descending into plain objects and arrays, and
 * returns the path of every `undefined` found along the way.
 *
 * Paths are dotted for object properties (`'x.y'`) and bracketed for array
 * indices (`'arr[1]'`), matching how a developer would write the accessor
 * for that location. The top-level `path` argument defaults to `''`, so a
 * bare `undefined` passed directly (with no enclosing object/array) is
 * reported as the empty string.
 *
 * Existing only to make `State` shape regressions loud: `JSON.stringify`
 * silently drops `undefined` properties (see the "no optional fields" rule
 * in `state.ts`), so a missing-field bug would otherwise round-trip through
 * serialization without ever throwing. Walking the live object instead of
 * its serialized form catches the bug before that silent drop can happen.
 */
export function findUndefined(value: unknown, path = ''): string[] {
    if (value === undefined) {
        return [path];
    }

    if (Array.isArray(value)) {
        const found: string[] = [];

        for (let i = 0; i < value.length; i++) {
            found.push(...findUndefined(value[i], `${path}[${i}]`));
        }

        return found;
    }

    if (typeof value === 'object' && value !== null) {
        const found: string[] = [];

        for (const key of Object.keys(value)) {
            const nextPath = path.length > 0 ? `${path}.${key}` : key;

            found.push(...findUndefined((value as Record<string, unknown>)[key], nextPath));
        }

        return found;
    }

    return [];
}
