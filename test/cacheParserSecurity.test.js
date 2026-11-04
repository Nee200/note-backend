const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const makeDir = require('make-dir');

const cacheRequire = createRequire(require.resolve('make-dir'));
const parserPath = cacheRequire.resolve('semver');

test('the cache-tool parser rejects pathological ranges within a bounded child process', () => {
    const script = `
        const assert = require('node:assert/strict');
        const semver = require(${JSON.stringify(parserPath)});
        assert.equal(semver.validRange('v'.repeat(500000)), null);
        // This is the only semver call in make-dir 3.1.0. Check both sides of its boundary.
        for (const [version, expected] of [['10.11.0', false], ['10.12.0', true], ['24.22.1', true]]) {
            assert.equal(semver.satisfies(version, '>=10.12.0'), expected);
        }
    `;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp)$/i.test(key)));
    const child = spawnSync(process.execPath, ['-e', script], { env, timeout: 5000, windowsHide: true, encoding: 'utf8' });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
});

test('the cache helper still creates nested directories and returns existing paths', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-cache-parser-'));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('note-cache-parser-'));
        await fs.rm(root, { recursive: true, force: true });
    });
    const nested = path.join(root, 'cache', 'mongodb');
    assert.equal(await makeDir(nested), nested);
    assert.equal(await makeDir(nested), nested);
    assert.equal((await fs.stat(nested)).isDirectory(), true);
    const syncPath = path.join(root, 'sync', 'cache');
    assert.equal(makeDir.sync(syncPath), syncPath);
    assert.equal(makeDir.sync(syncPath), syncPath);
    assert.equal((await fs.stat(syncPath)).isDirectory(), true);
});
