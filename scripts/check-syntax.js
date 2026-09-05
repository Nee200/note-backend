const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'); let count = 0;
function check(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tmp', 'backups', 'output'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.[cm]?js$/.test(file)) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true }); if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); } count++; }
} }
check(root); console.log(count + ' JavaScript-Dateien syntaktisch geprüft.');
