const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { npmAdvisories } = require('../services/securitySources');

const sourceModule = require.resolve('../services/securitySources');
const inventory = {
    target: 'synthetic revision',
    packages: [{ name: 'fixture-package', version: '1.2.3', scope: 'runtime' }]
};

function isolatedRangeCheck(code) {
    // A broken parser must time out only this disposable child, never the test runner.
    // The synthetic response is smaller than the monitor's source-body limit.
    const script = `
        const assert = require('node:assert/strict');
        const { npmAdvisories } = require(${JSON.stringify(sourceModule)});
        const inventory = ${JSON.stringify(inventory)};
        const response = range => async () => JSON.stringify({
            'fixture-package': [{ id: 'synthetic', title: 'Fixture', severity: 'low', vulnerable_versions: range }]
        });
        (async () => { ${code} })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp)$/i.test(key)));
    const result = spawnSync(process.execPath, ['-e', script], { env, timeout: 5000, windowsHide: true, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('npm monitoring rejects pathological invalid ranges without stalling the process', () => {
    isolatedRangeCheck(`
        await assert.rejects(npmAdvisories(inventory, response('v'.repeat(500000))), /Unbekannter npm-Versionsbereich/);
        const following = await npmAdvisories(inventory, response('>= 1.0.0 < 2.0.0'));
        assert.equal(following.findings.length, 1, 'a subsequent normal scan still reports its finding');
    `);
});

test('npm monitoring preserves affected-version detection for long valid prefixes', () => {
    isolatedRangeCheck(`
        const result = await npmAdvisories(inventory, response('>= ' + 'v'.repeat(500000) + '1 <2'));
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].installed, '1.2.3');
        assert.equal(result.findings[0].state, 'affected-version');
        assert.ok(result.findings[0].detail.length < 250, 'displayed source text stays bounded');
    `);
});

test('npm range matching retains bounds, prereleases and build dependency scopes', async () => {
    const packages = ['1.2.2', '1.2.3', '1.5.0-beta.1', '2.0.0'].map((version, index) => ({
        name: 'fixture-package', version, scope: index === 2 ? 'build/test' : 'runtime'
    }));
    const result = await npmAdvisories({ ...inventory, packages }, async () => JSON.stringify({
        'fixture-package': [{ id: 'bounds', vulnerable_versions: '>= 1.2.3 < 2.0.0', severity: 'high' }]
    }));
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].installed, '1.2.3, 1.5.0-beta.1');
    assert.equal(result.findings[0].scope, 'runtime, build/test');
});
