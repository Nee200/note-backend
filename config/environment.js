const path = require('node:path');

function loadEnvironment(env = process.env) {
    // Exactly one file; explicitly supplied hosting variables always win.
    require('dotenv').config({ path: env.DOTENV_CONFIG_PATH || path.join(__dirname, '../.env'), override: false, processEnv: env, quiet: true });
    return env;
}

function assertLocalTestDatabase(uri) {
    const match = String(uri || '').match(/^mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/(note-(?:localtest|test|audit)[a-zA-Z0-9_-]*)(?:\?.*)?$/);
    if (!match) throw new Error('Testmodus erfordert eine lokale, ausdrücklich benannte note-localtest/note-test/note-audit Datenbank.');
}

function validateEnvironment(env) {
    const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
    if (env.NODE_ENV === 'production' && (nodeMajor !== 24 || nodeMinor < 20)) throw new Error('Produktion erfordert Node.js 24.20.0 oder einen neueren Patchstand der 24er-Version.');
    const safe = env.LOCAL_DEV_SAFE_MODE === 'true' || env.NODE_ENV === 'test';
    if (safe) {
        if (env.NODE_ENV === 'production') throw new Error('Testmodus und Produktion dürfen nicht kombiniert werden.');
        assertLocalTestDatabase(env.MONGO_URI);
    }
    if (env.CHECKOUT_DRY_RUN === 'true' && !safe) throw new Error('CHECKOUT_DRY_RUN erfordert einen vollständig isolierten Testmodus.');
    if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) throw new Error('JWT_SECRET muss mindestens 32 Bytes lang sein.');
    if (env.NODE_ENV === 'production') for (const key of ['PROXY_SHARED_SECRET', 'NEWSLETTER_UNSUBSCRIBE_SECRET']) {
        if (Buffer.byteLength(env[key] || '') < 32) throw new Error(key + ' muss mindestens 32 Bytes lang sein.');
    }
    return { safe, production: env.NODE_ENV === 'production' };
}

module.exports = { loadEnvironment, validateEnvironment, assertLocalTestDatabase };
