const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codeqlCoverage } = require('../scripts/refresh-github-security');
const revision = 'a'.repeat(40);
const config = { languages: ['actions', 'javascript', 'javascript-typescript', 'typescript'] };
const analysis = (language, patch = {}) => ({ category: '/language:' + language, tool: 'CodeQL', commit_sha: revision, created_at: '2026-10-21T10:00:00Z', error: '', ...patch });

test('an Actions-only scan cannot clear the application security coverage', () => {
    const checks = codeqlCoverage(config, [analysis('actions')], revision);
    assert.deepEqual(checks.map(check => check.ok), [true, false]);
    assert.equal(checks.length, 2);
});

test('both current language analyses are needed; old commits, unrelated tools and errors cannot satisfy coverage', () => {
    const current = [analysis('actions'), analysis('javascript-typescript')];
    assert.ok(codeqlCoverage(config, current, revision).every(check => check.ok));
    for (const patch of [{ commit_sha: 'b'.repeat(40) }, { tool: 'Other scanner' }, { error: 'analysis failed' }, { category: '' }]) {
        assert.equal(codeqlCoverage(config, [current[0], analysis('javascript-typescript', patch)], revision)[1].ok, false);
    }
});

test('a later failed scan or disabled language remains incomplete despite an earlier successful analysis', () => {
    const current = [analysis('actions'), analysis('javascript-typescript')];
    assert.equal(codeqlCoverage(config, [...current, analysis('javascript-typescript', { created_at: '2026-10-21T11:00:00Z', error: 'scan failed' })], revision)[1].ok, false);
    assert.equal(codeqlCoverage({ languages: ['actions'] }, current, revision)[1].ok, false);
    assert.ok(codeqlCoverage({}, current, revision).every(check => !check.ok));
});
