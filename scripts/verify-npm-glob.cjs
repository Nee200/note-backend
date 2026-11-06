const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
function child(parent, name) {
    const result = path.resolve(parent, name);
    assert.equal(path.dirname(result), parent, 'Only direct children of the verified directory may be changed');
    return result;
}
async function removeOwned(parent, name) {
    const target = child(parent, name);
    assert.equal(await fs.realpath(path.dirname(target)), parent);
    await fs.rm(target, { recursive: true, force: true });
}
async function verify(npmRoot) {
    const fromNpm = createRequire(path.join(npmRoot, 'package.json'));
    const { glob, globStreamSync } = fromNpm('glob');
    const temp = await fs.realpath(os.tmpdir());
    const fixture = await fs.mkdtemp(path.join(temp, 'note-glob-check-'));
    const files = ['a/one.txt', 'a/b/two.txt', 'c/three.txt', 'c/d/four.txt'];
    try {
        for (const file of files) { await fs.mkdir(path.dirname(path.join(fixture, file)), { recursive: true }); await fs.writeFile(path.join(fixture, file), 'fixture'); }
        assert.deepEqual((await glob('**/*.txt', { cwd: fixture })).map(file => file.split(path.sep).join('/')).sort(), [...files].sort());
        const reason = Error('synthetic-abort');
        const counted = controller => {
            const stats = { reads: 0 };
            const count = () => { if (++stats.reads === 1) controller.abort(reason); };
            return { stats, fs: { ...nativeFs,
                readdir: (...args) => { count(); return nativeFs.readdir(...args); },
                readdirSync: (...args) => { count(); return nativeFs.readdirSync(...args); } } };
        };
        const controller = new AbortController();
        const asyncFs = counted(controller);
        await assert.rejects(glob('**', { cwd: fixture, signal: controller.signal, fs: asyncFs.fs }), reason);
        const atReject = asyncFs.stats.reads;
        await new Promise(resolve => setTimeout(resolve, 120));
        assert.equal(asyncFs.stats.reads, atReject, 'Directory reads must stop after cancellation');
        const syncController = new AbortController();
        const syncFs = counted(syncController);
        await new Promise((resolve, reject) => {
            const stream = globStreamSync('**', { cwd: fixture, signal: syncController.signal, fs: syncFs.fs });
            stream.on('error', error => { try { assert.equal(error, reason); assert.equal(syncFs.stats.reads, 1); resolve(); } catch (failure) { reject(failure); } });
            stream.resume();
        });
        return { normalMatches: files.length, asyncReadsAfterReject: asyncFs.stats.reads - atReject, syncAbortReads: syncFs.stats.reads };
    } finally { assert.ok(path.basename(fixture).startsWith('note-glob-check-')); await removeOwned(temp, path.basename(fixture)); }
}
module.exports = verify;
if (require.main === module) (async () => {
    assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]), 'Pass the absolute npm package directory');
    console.log(JSON.stringify(await verify(await fs.realpath(process.argv[2]))));
})().catch(error => { console.error(JSON.stringify({ name: error.name, code: error.code, message: error.message, actual: error.actual, expected: error.expected })); process.exitCode = 1; });