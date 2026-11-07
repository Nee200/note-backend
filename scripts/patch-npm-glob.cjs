// Temporary upstream backport for npm 11.21.2's bundled glob. Remove when npm ships it.
// https://github.com/isaacs/node-glob/commit/d94a8c8d0a89b89436d9612ebea6f9995104e05e
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const verify = require('./verify-npm-glob.cjs');
const integrity = 'sha512-wfsFgXQ8A3SEI9XGf7Nl3Y9l7ffSrGh7SUCT7vU/2CzYPep9kjxAn1S40F9OPKxAMGCVl7HtNlJhrCJUeUq83g==';
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
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
async function patch(npmRoot) {
    const fromNpm = createRequire(path.join(npmRoot, 'package.json'));
    const npm = await readJson(path.join(npmRoot, 'package.json'));
    assert.equal(npm.name, 'npm'); assert.equal(npm.version, '11.21.2', 'Reassess this backport when updating npm');
    const modules = await fs.realpath(path.join(npmRoot, 'node_modules'));
    const destination = child(modules, 'glob');
    assert.equal(await fs.realpath(destination), destination, 'Refusing a linked glob directory');
    assert.equal(fromNpm.resolve('glob/package.json'), path.join(destination, 'package.json'));
    const before = await readJson(path.join(destination, 'package.json'));
    assert.ok(['13.0.6', '13.0.7'].includes(before.version), 'Unexpected bundled glob; review before replacing');
    const response = await fetch('https://registry.npmjs.org/glob/-/glob-13.0.7.tgz', { redirect: 'error', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= 8000000, 'Package exceeds size limit'); chunks.push(chunk); }
    const archive = Buffer.concat(chunks);
    assert.equal('sha512-' + crypto.createHash('sha512').update(archive).digest('base64'), integrity, 'Package integrity mismatch');
    const suffix = crypto.randomBytes(6).toString('hex');
    const staged = child(modules, '.note-glob-new-' + suffix);
    const rollback = child(modules, '.note-glob-old-' + suffix);
    await fs.mkdir(staged);
    let moved = false, activated = false;
    try {
        const tar = fromNpm('tar');
        await new Promise((resolve, reject) => {
            const extraction = tar.x({ cwd: staged, strip: 1, strict: true, preservePaths: false,
                filter: (file, entry) => {
                    assert.ok(file.startsWith('package/') && !file.split(/[\\/]/).includes('..'), 'Unexpected archive path');
                    assert.ok(['File', 'Directory'].includes(entry.type), 'Links are not permitted in the backport');
                    return true;
                } });
            extraction.on('error', reject); extraction.on('close', resolve); extraction.end(archive);
        });
        const after = await readJson(path.join(staged, 'package.json'));
        assert.equal(after.name, 'glob'); assert.equal(after.version, '13.0.7');
        assert.deepEqual(after.dependencies, before.dependencies, 'The backport must not change dependency ranges');
        const semver = fromNpm('semver');
        for (const [name, range] of Object.entries(after.dependencies)) assert.ok(semver.satisfies(fromNpm(name + '/package.json').version, range), name + ' does not meet the backport requirements');
        // Both rename targets are direct children of the verified npm node_modules.
        await fs.rename(destination, rollback); moved = true;
        await fs.rename(staged, destination); activated = true;
        const checks = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'verify-npm-glob.cjs')], { cwd: npmRoot, encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
        await fs.writeFile(path.join(npmRoot, 'note-security-patches.json'), JSON.stringify({ npm: npm.version, package: 'glob', before: before.version, after: after.version, integrity, checkedAt: new Date().toISOString(), checks }, null, 2));
        moved = false; // Verified installation is committed; cleanup failure must not undo it.
        await removeOwned(modules, path.basename(rollback));
        return { status: 'patched', npm: npm.version, previousGlob: before.version, glob: after.version, checks };
    } catch (error) {
        if (moved) {
            if (activated) await removeOwned(modules, 'glob');
            await fs.rename(rollback, destination);
        }
        throw error;
    } finally { await removeOwned(modules, path.basename(staged)); }
}
if (require.main === module) (async () => {
    // Only the npm bundled with the running Node distribution is a CLI target.
    // CI and Cloudflare first install the pinned npm into that private prefix.
    const target = process.platform === 'win32'
        ? path.join(path.dirname(process.execPath), 'node_modules/npm')
        : path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm');
    const npmRoot = await fs.realpath(target);
    console.log(JSON.stringify(await patch(npmRoot)));
})().catch(error => { console.error(JSON.stringify({ name: error.name, code: error.code, message: error.message, actual: error.actual, expected: error.expected })); process.exitCode = 1; });
module.exports = { patch, verify };
