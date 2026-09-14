// Creates a pending invitation only. The recipient must choose a password and confirm MFA.
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
async function main() {
    const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
    if (!args.includes('--username') || !args.includes('--out')) throw new Error('Aufruf: node scripts/invite-admin.js --username betreiber --out ABSOLUTE_PRIVATE_FILE [--apply] [--renew]');
    const username = option('--username'), output = path.resolve(option('--out'));
    const backend = path.resolve(__dirname, '..'), frontend = path.resolve(backend, '../frontend');
    if ([backend, frontend].some(root => output === root || output.startsWith(root + path.sep))) throw new Error('Die Einladung muss außerhalb der Frontend- und Backend-Repositories gespeichert werden.');
    if (!args.includes('--apply')) { console.log(JSON.stringify({ dryRun: true, username, output, renew: args.includes('--renew') })); return; }
    const env = require('../config/environment').loadEnvironment();
    if (!env.MONGO_URI || !env.JWT_SECRET) throw new Error('Datenbank und Sitzungsschlüssel fehlen.');
    const reserved = require('../services/adminAuth').createAdminAuthenticator(env).hasAccount;
    await fs.mkdir(path.dirname(output), { recursive: true });
    const file = await fs.open(output, 'wx', 0o600);
    try {
        await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
        const { createAdminEnrollment } = require('../services/adminEnrollment');
        await require('../models/AdminAccount').init();
        const invitation = await createAdminEnrollment({ secret: env.JWT_SECRET, reserved }).invite(username, 'local-provisioning', args.includes('--renew'));
        const origin = env.FRONTEND_PUBLIC_URL || 'https://note-fragrances.de';
        await file.writeFile(`NØTE. Betreiber-Zugang\n\nAnmeldung: ${new URL('/admin', origin)}\nBenutzername: ${invitation.username}\nEinmalpasswort: ${invitation.oneTimePassword}\nGültig bis: ${invitation.expiresAt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} (Deutschland)\n\n1. Mit Benutzername und Einmalpasswort anmelden. Authenticator-Feld zunächst leer lassen.\n2. Eigenes Passwort mit mindestens 16 Zeichen festlegen.\n3. QR-Code mit der Authenticator-App scannen und den sechsstelligen Code bestätigen.\n\nErst danach ist der Zugang aktiv. Die Einrichtung ist nach der ersten Anmeldung 30 Minuten möglich. Bei Abbruch, Ablauf oder Geräteverlust während der Einrichtung bitte eine neue Einladung anfordern. Das Einmalpasswort kann kein zweites Mal verwendet werden.\n`, 'utf8');
        console.log(JSON.stringify({ created: true, username, status: 'invited', expiresAt: invitation.expiresAt, file: output }));
    } finally { await file.close(); await mongoose.disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
