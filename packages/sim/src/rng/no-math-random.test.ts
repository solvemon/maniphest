import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The package root (`packages/sim`), resolved from this file's own location
 * rather than `process.cwd()`. This file lives at `<pkg>/src/rng/`, so the
 * package root is two levels up. Anchoring to `import.meta.dirname` keeps
 * the file collectors correct no matter where the test runner is invoked
 * from.
 */
const packageRoot = path.resolve(import.meta.dirname, '..', '..');

/**
 * Collects every TypeScript source file under `src/`, excluding test files.
 * Test files are excluded so the banned-random checker never matches its
 * own regex literal.
 */
export function collectSourceFiles(): string[] {
    const files = fs.globSync('src/**/*.ts', { cwd: packageRoot, exclude: ['**/*.test.ts'] });

    return files.map((file) => path.resolve(packageRoot, file)).sort();
}

/**
 * Collects every compiled JavaScript file under `dist/`.
 */
export function collectDistFiles(): string[] {
    const files = fs.globSync('dist/**/*.js', { cwd: packageRoot });

    return files.map((file) => path.resolve(packageRoot, file)).sort();
}

/**
 * Textual grep layer that flags any line referencing one of the three
 * entropy sources banned by `eslint.config.js`, however each is spelled:
 *
 * - `Math.random` — via `.` member access (`Math.random`, `Math . random`
 *   with whitespace around the dot) or bracket-property access
 *   (`Math['random']` / `Math["random"]`). Mirrors the `no-restricted-properties`
 *   rule for `{ object: 'Math', property: 'random' }`.
 * - `Date.now` / `new Date` — via `.` member access (`Date.now`,
 *   `Date . now`) or bracket-property access (`Date['now']` /
 *   `Date["now"]`) for the former, plus the `new Date(...)` constructor
 *   call form. Mirrors the `no-restricted-globals` entry for `Date`.
 * - `crypto.*` — any member access on the `crypto` global, via `.`
 *   (`crypto.getRandomValues`, `crypto . randomUUID`) or bracket-property
 *   access (`crypto['getRandomValues']` / `crypto["randomUUID"]`), since
 *   any property of `crypto` is a wall-clock-independent but still
 *   non-deterministic entropy source. Mirrors the `no-restricted-globals`
 *   entry for `crypto`.
 *
 * This is deliberately a source-text scan rather than an AST check: it
 * complements the `no-restricted-properties` / `no-restricted-globals`
 * ESLint rules (configured in `eslint.config.js`), which only inspect real
 * AST nodes and therefore cannot see occurrences inside comments or string
 * literals. Scanning raw text catches those too, at the cost of also
 * flagging matches that appear inside comments/strings - an accepted
 * trade-off for this guard, since sim code must never mention a banned API
 * at all, including in prose.
 *
 * Bare references to the `Date` or `crypto` identifiers (with no property
 * access and no `new`) are intentionally NOT flagged — e.g. passing `Date`
 * itself as a value, or a local variable merely named `crypto`/`date`,
 * would be a false positive for this line-based grep. In practice sim code
 * never has a legitimate reason to reference either identifier at all, so
 * this is not expected to matter; if a genuine need ever arises, prefer
 * renaming/avoiding the identifier over adding an allowlist escape hatch,
 * since this guard is deliberately strict-by-default.
 *
 * Matching is line-based and 1-indexed to make findings easy to report
 * against a file's line numbers.
 */
export function findBannedRandom(source: string): number[] {
    const pattern =
        /\bMath\s*(?:\.\s*random\b|\[\s*['"]random['"]\s*\])|\bDate\s*(?:\.\s*now\b|\[\s*['"]now['"]\s*\])|\bnew\s+Date\b|\bcrypto\s*(?:\.\s*[A-Za-z_$][\w$]*\b|\[\s*['"][^'"]+['"]\s*\])/;
    const lines = source.split('\n');
    const matches: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';

        if (pattern.test(line)) {
            matches.push(i + 1);
        }
    }

    return matches;
}

test('should find no matches in source with no banned reference', () => {
    const source = [
        'const x = 1;',
        'function f() { return x + 1; }',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), []);
});

/**
 * Matcher self-tests below. These use fixture strings that describe the
 * banned pattern rather than invoking it, so this file stays a valid
 * exclusion from `collectSourceFiles()` (which skips `*.test.ts`).
 */

test('should flag plain Math.random() call form', () => {
    const source = [
        'const a = 1;',
        'const b = Math.random();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag Math . random () form with whitespace around the dot', () => {
    const source = [
        'const a = 1;',
        'const b = Math . random ();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test("should flag Math['random']() bracket-property access with single quotes", () => {
    const source = [
        'const a = 1;',
        "const b = Math['random']();",
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag Math["random"]() bracket-property access with double quotes', () => {
    const source = [
        'const a = 1;',
        'const b = Math["random"]();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should report correct 1-indexed line numbers across a multi-line fixture with several forms', () => {
    const source = [
        '// line 1: harmless',
        'const a = 1;',
        'const b = Math.random();',
        'const c = 2;',
        'const d = Math . random ();',
        'const e = 3;',
        "const f = Math['random']();",
        'const g = 4;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [3, 5, 7]);
});

test('should flag plain Date.now() call form', () => {
    const source = [
        'const a = 1;',
        'const b = Date.now();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag Date . now () form with whitespace around the dot', () => {
    const source = [
        'const a = 1;',
        'const b = Date . now ();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test("should flag Date['now']() bracket-property access with single quotes", () => {
    const source = [
        'const a = 1;',
        "const b = Date['now']();",
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag Date["now"]() bracket-property access with double quotes', () => {
    const source = [
        'const a = 1;',
        'const b = Date["now"]();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag new Date() constructor call', () => {
    const source = [
        'const a = 1;',
        'const b = new Date();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag new Date(...) constructor call with extra whitespace after new', () => {
    const source = [
        'const a = 1;',
        'const b = new    Date(2024, 0, 1);',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag crypto.getRandomValues() member access', () => {
    const source = [
        'const a = 1;',
        'const b = crypto.getRandomValues(new Uint32Array(1));',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag crypto . randomUUID () form with whitespace around the dot', () => {
    const source = [
        'const a = 1;',
        'const b = crypto . randomUUID ();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test("should flag crypto['randomUUID']() bracket-property access with single quotes", () => {
    const source = [
        'const a = 1;',
        "const b = crypto['randomUUID']();",
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should flag crypto["getRandomValues"]() bracket-property access with double quotes', () => {
    const source = [
        'const a = 1;',
        'const b = crypto["getRandomValues"]();',
        'const c = 3;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should report correct 1-indexed line numbers across a multi-line fixture mixing all banned forms', () => {
    const source = [
        '// line 1: harmless',
        'const a = 1;',
        'const b = Math.random();',
        'const c = 2;',
        'const d = Date.now();',
        'const e = 3;',
        'const f = new Date();',
        'const g = 4;',
        'const h = crypto.getRandomValues(new Uint32Array(1));',
        'const i = 5;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [3, 5, 7, 9]);
});

test('should NOT flag the unrelated identifier mathRandomizer', () => {
    // Genuine non-match: the pattern requires `\bMath` immediately followed
    // (after optional whitespace) by either `.` or `[`. `mathRandomizer` is
    // a single identifier with no such separator, and the leading `m` is
    // lowercase besides, so `\bMath` never matches inside it at all.
    const source = [
        'const mathRandomizer = createRandomizer();',
        'const value = mathRandomizer.next();',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), []);
});

test('should NOT flag unrelated Date-ish and crypto-ish identifiers', () => {
    // Genuine non-matches: `updateDate`/`dateFormatter` never have `Date`
    // start at a word boundary followed by `.now`/`[...]`/preceded by
    // `new `, and `cryptoUtils` never has `crypto` immediately followed
    // (after optional whitespace) by `.` or `[`. Plain-English words like
    // `validate`/`update`/`candidate` contain a lowercase `date` substring,
    // which never matches the case-sensitive `\bDate` requirement anyway.
    const source = [
        'const updateDate = () => {};',
        'const dateFormatter = createDateFormatter();',
        'const cryptoUtils = createCryptoUtils();',
        'function validate(candidate) { return update(candidate); }',
        "const scheduledAt = record['dateFormatter'];",
        'const b = new DateFormatter();',
        'const c = new Database();',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), []);
});

test('should NOT flag a bare Date or crypto reference with no property access or new', () => {
    // Bare identifier references (no `.`/`[...]` access, no `new`) are
    // intentionally out of scope for this line-based grep - see the
    // `findBannedRandom` doc comment for why.
    const source = [
        'type Clock = typeof Date;',
        'const supportsCrypto = typeof crypto !== "undefined";',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), []);
});

test('should flag banned text even inside a comment, by design', () => {
    // DELIBERATE choice, not a bug: `findBannedRandom` is a textual grep
    // layer, not the AST-based `no-restricted-properties` ESLint rule. The
    // ESLint rule only inspects `MemberExpression` nodes in real code, so it
    // correctly ignores comments and string literals - that layer must never
    // false-positive on prose. This textual layer intentionally has no such
    // exemption: it flags `Math.random` wherever the bytes appear, including
    // inside comments and strings. Per DESIGN.md §4, the two layers are
    // complementary belt-and-braces, chosen because a comment mentioning the
    // banned call is cheap to reword, whereas a textual scanner that skips
    // comments could be evaded by string-built dynamic property access
    // (e.g. constructing `'random'` piecemeal to dodge a comment-blind grep).
    const source = [
        'const a = 1;',
        '// see Math.random for why this function is deterministic',
        'const b = 2;',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), [2]);
});

test('should return an empty array for a clean fixture with no banned text', () => {
    const source = [
        '/** A well-behaved module. */',
        'export function add(x: number, y: number): number {',
        '    return x + y;',
        '}',
    ].join('\n');

    assert.deepEqual(findBannedRandom(source), []);
});

test('should find no banned randomness calls anywhere in package source', () => {
    const files = collectSourceFiles();

    assert.ok(
        files.length > 0,
        `expected to find at least one source file under package root ${packageRoot}, but the glob matched none`,
    );

    const violations: string[] = [];

    for (const file of files) {
        const contents = fs.readFileSync(file, 'utf8');
        const lines = findBannedRandom(contents);

        if (lines.length > 0) {
            const relativePath = path.relative(packageRoot, file);

            violations.push(`${relativePath}: line(s) ${lines.join(', ')}`);
        }
    }

    assert.deepEqual(
        violations,
        [],
        `found banned randomness references in:\n${violations.join('\n')}`,
    );
});

test('should find no banned randomness calls anywhere in build output', () => {
    const files = collectDistFiles();

    if (files.length === 0) {
        assert.fail('dist/ not found — run `npm run build` first');
    }

    const violations: string[] = [];

    for (const file of files) {
        const contents = fs.readFileSync(file, 'utf8');
        const lines = findBannedRandom(contents);

        if (lines.length > 0) {
            const relativePath = path.relative(packageRoot, file);

            violations.push(`${relativePath}: line(s) ${lines.join(', ')}`);
        }
    }

    assert.deepEqual(
        violations,
        [],
        `found banned randomness references in:\n${violations.join('\n')}`,
    );
});
