const path = require('node:path');
function argument(name, args = process.argv.slice(2)) {
    const index = args.indexOf('--' + name); return index >= 0 ? args[index + 1] : undefined;
}
function prepare({ task, localOnly = false }, env = process.env, args = process.argv.slice(2)) {
    const envFile = argument('env', args) || env.DOTENV_CONFIG_PATH;
    if (envFile) require('dotenv').config({ path: path.resolve(envFile), override: false, processEnv: env, quiet: true });
    const apply = args.includes('--apply') || args.includes('--execute');
    if (env.MONGO_URI) {
        const match = env.MONGO_URI.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/]+)\/([^?]+)(?:\?.*)?$/);
        if (!match) throw new Error('MONGO_URI muss eine ausdrücklich benannte Datenbank enthalten.');
        if (localOnly) require('../config/environment').assertLocalTestDatabase(env.MONGO_URI);
        if (apply && (argument('database', args) !== match[2] || argument('host', args) !== match[1])) throw new Error('Schreibzugriff erfordert --database und --host mit exakt dem konfigurierten Ziel.');
    } else if (apply) throw new Error('MONGO_URI fehlt.');
    console.log(`[maintenance] ${task}: ${apply ? 'explizit freigegebener Schreiblauf' : 'Trockenlauf'}`);
    return { apply, argument: name => argument(name, args) };
}
module.exports = { prepare, argument };
