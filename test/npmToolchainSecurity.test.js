const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { patch } = require('../scripts/patch-npm-glob.cjs');

async function fixture(t, npmVersion = '11.21.2', globVersion = '13.0.6') {
    const parent = await fs.realpath(os.tmpdir());
    const root = await fs.mkdtemp(path.join(parent, 'note-npm-security-'));
    const directory = path.join(root, 'node_modules/glob');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'npm', version: npmVersion }));
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'glob', version: globVersion }));
    await fs.writeFile(path.join(directory, 'sentinel.txt'), 'leave-installed-files-intact');
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(root)), parent);
        assert.ok(path.basename(root).startsWith('note-npm-security-'));
        await fs.rm(root, { recursive: true, force: true });
    });
    return root;
}
async function unchanged(root, globVersion) {
    assert.equal(await fs.readFile(path.join(root, 'node_modules/glob/sentinel.txt'), 'utf8'), 'leave-installed-files-intact');
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'node_modules/glob/package.json'), 'utf8')).version, globVersion);
    assert.deepEqual(await fs.readdir(path.join(root, 'node_modules')), ['glob']);
}
test('npm backport refuses a different npm release before fetching or changing files', async t => {
    const root = await fixture(t, '11.21.3');
    const request = t.mock.method(globalThis, 'fetch', () => { throw Error('Network must not be reached'); });
    await assert.rejects(patch(root), /Reassess this backport/);
    assert.equal(request.mock.callCount(), 0);
    await unchanged(root, '13.0.6');
});
test('npm backport refuses an unreviewed glob release before changing files', async t => {
    const root = await fixture(t, '11.21.2', '13.0.8');
    const request = t.mock.method(globalThis, 'fetch', () => { throw Error('Network must not be reached'); });
    await assert.rejects(patch(root), /Unexpected bundled glob/);
    assert.equal(request.mock.callCount(), 0);
    await unchanged(root, '13.0.8');
});
test('npm backport rejects a tampered archive and preserves the installed package', async t => {
    const root = await fixture(t);
    const request = t.mock.method(globalThis, 'fetch', async url => {
        assert.equal(url, 'https://registry.npmjs.org/glob/-/glob-13.0.7.tgz');
        return new Response('synthetic-untrusted-archive');
    });
    await assert.rejects(patch(root), /Package integrity mismatch/);
    assert.equal(request.mock.callCount(), 1);
    await unchanged(root, '13.0.6');
});
