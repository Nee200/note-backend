const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const semver = require('semver');

const FRONTEND = 'https://www.note-fragrances.de';
const BACKEND = 'https://note-backend-5gy0.onrender.com';
const HOSTS = new Set(['www.note-fragrances.de', 'note-backend-5gy0.onrender.com', 'raw.githubusercontent.com', 'registry.npmjs.org', 'api.osv.dev', 'nodejs.org', 'downloads.mongodb.org', 'services.nvd.nist.gov']);
const cut = (value, limit = 500) => String(value ?? '').slice(0, limit);
const levels = new Set(['critical', 'high', 'moderate', 'medium', 'low']);
const severity = value => levels.has(String(value).toLowerCase()) ? String(value).toLowerCase().replace('moderate', 'medium') : 'unknown';

// Fixed origins only. No browser input, credentials or customer data are sent to scanners.
function createReader(fetchImpl = fetch) {
    return async (url, { body, maxBytes = 5000000, headersOnly = false } = {}) => {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw Error('Quelle nicht erlaubt.');
        const response = await fetchImpl(parsed, {
            method: body ? 'POST' : (headersOnly ? 'HEAD' : 'GET'), redirect: 'error',
            signal: AbortSignal.timeout(20000),
            headers: { Accept: 'application/json', 'User-Agent': 'NOTE-security-monitor/1.0', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response.ok) { await response.body?.cancel(); throw Error('Quelle antwortet mit HTTP ' + response.status + '.'); }
        if (headersOnly) { await response.body?.cancel(); return Object.fromEntries(response.headers); }
        let size = 0; const chunks = [];
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maxBytes) throw Error('Quellantwort überschreitet das Größenlimit.');
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf8');
    };
}

function inventory(lock, target) {
    if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || !lock.packages['']) throw Error('Lockdatei nicht auswertbar.');
    const packages = new Map();
    for (const [location, entry] of Object.entries(lock.packages)) {
        if (!location || entry.link) continue;
        const name = entry.name || location.split('node_modules/').at(-1);
        if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || !semver.valid(entry.version)) throw Error('Paketinventar enthält nicht unterstützte Einträge.');
        const key = name + '@' + entry.version;
        const previous = packages.get(key);
        packages.set(key, { name, version: entry.version, scope: previous?.scope === 'runtime' || !entry.dev ? 'runtime' : 'build/test' });
    }
    if (!packages.size || packages.size > 2500) throw Error('Paketinventar fehlt oder ist zu groß.');
    const root = lock.packages[''];
    const direct = Object.keys({ ...root.dependencies, ...root.devDependencies }).map(name => {
        const entry = lock.packages['node_modules/' + name];
        return entry && { name, version: entry.version, scope: root.dependencies?.[name] ? 'runtime' : 'build/test' };
    }).filter(Boolean);
    return { target, packages: [...packages.values()], direct };
}

async function deployedFrontend(read) {
    const meta = JSON.parse(await read(FRONTEND + '/security-build-info.json', { maxBytes: 10000 }));
    if (meta.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(meta.commit) || !/^[a-f0-9]{64}$/.test(meta.lockSha256) || !semver.valid(meta.nodeVersion)) throw Error('Frontend-Buildnachweis fehlt oder ist ungültig.');
    const raw = await read(`https://raw.githubusercontent.com/Nee200/note-frontend/${meta.commit}/package-lock.json`);
    if (crypto.createHash('sha256').update(raw).digest('hex') !== meta.lockSha256) throw Error('Frontend-Lockdatei passt nicht zum veröffentlichten Build.');
    return { ...inventory(JSON.parse(raw), 'Frontend ' + meta.commit), meta };
}

async function npmAdvisories(inv, read) {
    const body = Object.create(null);
    for (const pkg of inv.packages) (body[pkg.name] ||= []).push(pkg.version);
    const data = JSON.parse(await read('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', { body }));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw Error('Ungültige npm-Antwort.');
    const findings = [];
    for (const [name, advisories] of Object.entries(data)) {
        if (!Array.isArray(advisories)) throw Error('Ungültige npm-Advisories.');
        for (const item of advisories) {
            if (!semver.validRange(item.vulnerable_versions)) throw Error('Unbekannter npm-Versionsbereich.');
            const affected = inv.packages.filter(pkg => pkg.name === name && semver.satisfies(pkg.version, item.vulnerable_versions, { includePrerelease: true }));
            if (affected.length) findings.push({ id: 'npm:' + cut(item.id, 80), title: cut(item.title), severity: severity(item.severity), package: name, installed: affected.map(pkg => pkg.version).join(', '), scope: [...new Set(affected.map(pkg => pkg.scope))].join(', '), detail: 'Betroffener Bereich: ' + cut(item.vulnerable_versions, 200), url: cut(item.url, 500), state: 'affected-version' });
        }
    }
    return { target: inv.target, summary: `${inv.packages.length} Paketversionen inklusive Build/Test mit npm-Advisories abgeglichen.`, findings, links: ['https://docs.npmjs.com/cli/v11/commands/npm-audit/'] };
}

async function osvAdvisories(inv, read) {
    const hits = new Map();
    let pending = inv.packages.map(pkg => ({ package: { name: pkg.name, ecosystem: 'npm' }, version: pkg.version }));
    for (let round = 0; pending.length; round++) {
        if (round >= 10) throw Error('OSV-Abfrage unvollständig: zu viele Ergebnisseiten.');
        const next = [];
        for (let start = 0; start < pending.length; start += 250) {
            const queries = pending.slice(start, start + 250);
            const data = JSON.parse(await read('https://api.osv.dev/v1/querybatch', { body: { queries } }));
            if (!Array.isArray(data.results) || data.results.length !== queries.length) throw Error('OSV-Abfrage unvollständig.');
            data.results.forEach((result, i) => {
                if (!result || result.error || (result.vulns !== undefined && !Array.isArray(result.vulns))) throw Error('OSV-Abfrage unvollständig.');
                for (const item of result.vulns || []) {
                    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(item.id)) throw Error('Ungültige OSV-Kennung.');
                    const affected = hits.get(item.id) || [];
                    affected.push(queries[i]); hits.set(item.id, affected);
                }
                if (result.next_page_token) next.push({ ...queries[i], page_token: result.next_page_token });
            });
        }
        pending = next;
    }
    if (hits.size > 100) throw Error('Über 100 OSV-Befunde; vollständige Auswertung in CI erforderlich.');
    const findings = [];
    for (const [id, affected] of hits) {
        const data = JSON.parse(await read('https://api.osv.dev/v1/vulns/' + id, { maxBytes: 2000000 }));
        if (data.id !== id) throw Error('OSV-Befund konnte nicht verifiziert werden.');
        if (data.withdrawn) continue;
        const fixes = (data.affected || []).filter(item => affected.some(pkg => pkg.package.name === item.package?.name)).flatMap(item => (item.ranges || []).flatMap(range => (range.events || []).map(event => event.fixed).filter(Boolean)));
        findings.push({ id, title: cut(data.summary || id), severity: severity(data.database_specific?.severity), package: [...new Set(affected.map(pkg => pkg.package.name))].join(', '), installed: [...new Set(affected.map(pkg => pkg.version))].join(', '), detail: fixes.length ? 'Gemeldete Fix-Versionen (je Versionszweig prüfen): ' + [...new Set(fixes)].join(', ') : 'Fix-Version im verlinkten Advisory prüfen.', url: 'https://osv.dev/vulnerability/' + id, aliases: (data.aliases || []).slice(0, 20).map(value => cut(value, 100)), state: 'affected-version' });
    }
    return { target: inv.target, summary: `${inv.packages.length} Paketversionen inklusive Build/Test mit OSV abgeglichen. Überschneidungen mit npm sind möglich.`, findings, links: ['https://osv.dev/'] };
}

async function dependencyUpdates(inv, read) {
    const updates = [];
    for (let start = 0; start < inv.direct.length; start += 5) {
        await Promise.all(inv.direct.slice(start, start + 5).map(async pkg => {
            const meta = JSON.parse(await read('https://registry.npmjs.org/' + encodeURIComponent(pkg.name) + '/latest', { maxBytes: 500000 }));
            if (!semver.valid(meta.version)) throw Error('Paketversion nicht auswertbar.');
            if (semver.gt(meta.version, pkg.version)) updates.push({ name: pkg.name, installed: pkg.version, latest: meta.version, scope: pkg.scope, breaking: semver.major(meta.version) !== semver.major(pkg.version) || (semver.major(meta.version) === 0 && semver.minor(meta.version) !== semver.minor(pkg.version)), url: 'https://www.npmjs.com/package/' + pkg.name });
        }));
    }
    return { target: inv.target, summary: 'Neueste stabile Versionen direkter Abhängigkeiten. Ein verfügbares Update ist noch kein Sicherheitsbefund.', updates: updates.sort((a, b) => a.name.localeCompare(b.name)) };
}

function nodeRelease(version, releases, schedule, now = Date.now()) {
    if (!semver.valid(version) || !Array.isArray(releases)) throw Error('Node-Versionen nicht auswertbar.');
    const major = semver.major(version), lifecycle = schedule['v' + major];
    const branch = releases.filter(row => semver.valid(row.version) && semver.major(row.version) === major).sort((a, b) => semver.rcompare(a.version, b.version));
    if (!branch.length || !lifecycle?.end || !Number.isFinite(Date.parse(lifecycle.end))) throw Error('Node-Supportstatus unbekannt.');
    const findings = [], latest = branch[0].version.replace(/^v/, '');
    if (Date.parse(lifecycle.end) < now) findings.push({ id: 'node-eol-' + major, severity: 'high', title: 'Node-Versionszweig erhält keine regulären Sicherheitsupdates mehr.', detail: 'Supportende: ' + lifecycle.end, url: 'https://github.com/nodejs/Release#release-schedule', state: 'confirmed' });
    const securityUpdate = branch.find(row => row.security === true && semver.gt(row.version, version));
    if (securityUpdate) findings.push({ id: 'node-security-release-' + securityUpdate.version, severity: 'high', title: 'Node-Sicherheitsrelease verfügbar', detail: `${version} → ${securityUpdate.version}`, url: 'https://nodejs.org/en/blog/release/' + securityUpdate.version, state: 'confirmed' });
    return { summary: `Node ${version}; aktuell im Zweig ${major}: ${latest}; Support bis ${lifecycle.end}. Versions-/Supportabgleich, keine vollständige Codeprüfung.`, findings, updates: semver.gt(latest, version) ? [{ name: 'Node.js', installed: version, latest, breaking: false }] : [], links: ['https://nodejs.org/en/security/'] };
}

function mongoRelease(version, data) {
    if (!semver.valid(version) || !Array.isArray(data.versions)) throw Error('MongoDB-Versionen nicht auswertbar.');
    const releases = data.versions.filter(row => semver.valid(row.version) && !semver.prerelease(row.version) && semver.major(row.version) === semver.major(version) && semver.minor(row.version) === semver.minor(version)).sort((a, b) => semver.rcompare(a.version, b.version));
    if (!releases.length) throw Error('MongoDB-Versionszweig nicht im Herstellerindex gefunden.');
    const latest = releases[0].version;
    return { summary: `MongoDB ${version}; neueste im Herstellerindex gefundene Version dieses Zweigs: ${latest}. Supportlaufzeit und Atlas-Einstellungen werden separat geprüft.`, updates: semver.gt(latest, version) ? [{ name: 'MongoDB', installed: version, latest, breaking: false, url: 'https://www.mongodb.com/resources/products/alerts' }] : [], links: ['https://www.mongodb.com/resources/products/alerts'] };
}

async function nvdMatches(product, version, read, { atlas = false } = {}) {
    if (!semver.valid(version)) throw Error('Version für CVE-Abgleich fehlt.');
    const cpe = product === 'node' ? `cpe:2.3:a:nodejs:node.js:${version}:*:*:*:*:*:*:*` : `cpe:2.3:a:mongodb:mongodb:${version}:*:*:*:*:*:*:*`;
    const findings = [], checks = [];
    for (let start = 0; ; start += 100) {
        const data = JSON.parse(await read('https://services.nvd.nist.gov/rest/json/cves/2.0?cpeName=' + encodeURIComponent(cpe) + '&resultsPerPage=100&startIndex=' + start));
        if (!Array.isArray(data.vulnerabilities) || !Number.isInteger(data.totalResults) || data.totalResults > 500 || (data.totalResults > start && !data.vulnerabilities.length)) throw Error('NVD-Abgleich unvollständig.');
        for (const { cve } of data.vulnerabilities) {
            if (!cve || cve.vulnStatus === 'Rejected') continue;
            const targetPrefix = product === 'node' ? 'cpe:2.3:a:nodejs:node.js:' : 'cpe:2.3:a:mongodb:mongodb:';
            const matches = [];
            const walk = node => { matches.push(...(node.cpeMatch || [])); for (const child of node.nodes || []) walk(child); };
            for (const config of cve.configurations || []) walk(config);
            // NVD also returns CVEs for software that merely runs ON Node/MongoDB.
            // Those platform requirements are explicitly marked vulnerable:false.
            if (matches.length && !matches.some(match => match.vulnerable === true && match.criteria?.startsWith(targetPrefix))) continue;
            // This reviewed historical CVE requires MongoDB inside Red Hat Satellite 6.
            // Atlas is a different server deployment. Keep the assessment visible and
            // restrict it to the verified version; a changed environment needs review.
            if (product === 'mongodb' && version === '8.0.34' && atlas && cve.id === 'CVE-2014-8180' && matches.some(match => match.vulnerable === false && match.criteria?.startsWith('cpe:2.3:a:redhat:satellite:6.0:'))) {
                checks.push({ label: 'CVE-2014-8180: am 21.10.2026 als nicht betroffen bewertet. Setzt Red Hat Satellite 6 voraus; geprüft wird MongoDB Atlas 8.0.34. NVD enthält hier einen zu weit gefassten MongoDB-Versionseintrag.', ok: true });
                continue;
            }
            const metric = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0] || cve.metrics?.cvssMetricV40?.[0];
            findings.push({ id: cut(cve.id, 100), severity: severity(metric?.cvssData?.baseSeverity), title: cut(cve.descriptions?.find(row => row.lang === 'en')?.value || cve.id), detail: 'CPE-/Versions-Treffer. Zusätzliche Bedingungen und Herstellerhinweise müssen geprüft werden.', url: 'https://nvd.nist.gov/vuln/detail/' + encodeURIComponent(cve.id), state: 'review' });
        }
        if (start + data.vulnerabilities.length >= data.totalResults) break;
    }
    return { target: `${product} ${version}`, summary: 'NVD-CVE-Abgleich anhand der installierten Produktversion. CPE-Treffer erfordern Prüfung; unbekannte oder noch nicht veröffentlichte Lücken werden nicht erfasst.', findings, checks, links: checks.length ? ['https://nvd.nist.gov/vuln/detail/CVE-2014-8180'] : [] };
}

async function databaseAccess(database) {
    const db = database.db || database;
    const data = await db.admin().command({ connectionStatus: 1, showPrivileges: false });
    const roles = data.authInfo?.authenticatedUserRoles;
    if (!Array.isArray(roles) || !roles.length) throw Error('Datenbankrollen nicht nachgewiesen.');
    const broad = roles.filter(row => ['atlasAdmin', 'root', 'dbOwner', 'userAdminAnyDatabase', 'dbAdminAnyDatabase', 'readWriteAnyDatabase', 'clusterAdmin', 'userAdmin'].includes(row.role) || (row.role === 'readWrite' && row.db !== db.databaseName));
    const unknown = roles.filter(row => !broad.includes(row) && !(['readWrite', 'read'].includes(row.role) && row.db === db.databaseName));
    return { target: 'Tatsächlich verbundener Datenbankbenutzer des Backend-Prozesses', summary: 'Rollen des angemeldeten Datenbankbenutzers geprüft, ohne Zugangsdaten zu speichern.',
        findings: broad.length ? [{ id: 'mongodb-overprivileged-runtime', title: 'Shop-Datenbankbenutzer hat zu weitreichende Rechte', severity: 'high', state: 'confirmed', detail: 'Gefundene Rollen: ' + broad.map(row => row.role).join(', ') + '. Einen eigenen Shop-Benutzer mit readWrite ausschließlich auf der Shop-Datenbank verwenden; Zugang koordiniert umstellen und alten Zugang prüfen.', url: 'https://www.mongodb.com/docs/atlas/security-add-mongodb-users/' }] : [],
        checks: roles.map(row => ({ label: row.role + (row.db === db.databaseName ? ' auf Shop-Datenbank' : ' außerhalb der Shop-Datenbank'), ok: !broad.includes(row) && !unknown.includes(row) })),
        gaps: unknown.length ? ['Zusätzliche/custom Datenbankrollen müssen einzeln auf notwendige Rechte geprüft werden.'] : [] };
}

async function headerCheck(url, read) {
    const headers = await read(url, { headersOnly: true });
    const required = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy'];
    const missing = required.filter(name => !headers[name]);
    return { target: url, summary: 'HTTPS-Verbindung und öffentliche Sicherheitsheader geprüft. Das prüft weder Anbieter-Konten noch interne Betriebssystempatches.', findings: missing.map(name => ({ id: 'header-' + name, severity: 'medium', title: 'Sicherheitsheader fehlt: ' + name, state: 'confirmed' })), checks: required.map(name => ({ label: name, ok: !!headers[name] })) };
}

function createSources({ read = createReader(), database, env = process.env, root = path.resolve(__dirname, '..') } = {}) {
    // All promises receive handlers immediately; a failed inventory must not terminate the server.
    const settled = promise => promise.then(value => ({ value }), error => ({ error }));
    const unwrap = async promise => { const result = await promise; if (result.error) throw result.error; return result.value; };
    const backend = settled(fs.readFile(path.join(root, 'package-lock.json'), 'utf8').then(raw => inventory(JSON.parse(raw), 'Backend ' + (/^[a-f0-9]{40}$/.test(env.RENDER_GIT_COMMIT || '') ? env.RENDER_GIT_COMMIT : 'Revision nicht nachgewiesen'))));
    const frontend = settled(deployedFrontend(read));
    const mongo = settled((database.db || database).admin().command({ buildInfo: 1 }).then(result => { if (!semver.valid(result.version)) throw Error('MongoDB-Version fehlt.'); return result.version; }));
    const nodeData = settled(Promise.all([read('https://nodejs.org/dist/index.json'), read('https://raw.githubusercontent.com/nodejs/Release/main/schedule.json')]).then(rows => rows.map(row => JSON.parse(row))));
    const sources = [];
    for (const [system, pending] of [['backend', backend], ['frontend', frontend]]) {
        sources.push([system + '-npm', async () => npmAdvisories(await unwrap(pending), read)]);
        sources.push([system + '-osv', async () => osvAdvisories(await unwrap(pending), read)]);
        sources.push([system + '-updates', async () => dependencyUpdates(await unwrap(pending), read)]);
    }
    sources.push(['node-backend', async () => ({ ...nodeRelease(process.versions.node, ...await unwrap(nodeData)), target: 'Render: laufender Node-Prozess ' + process.versions.node })]);
    sources.push(['node-frontend', async () => { const inv = await unwrap(frontend); return { ...nodeRelease(inv.meta.nodeVersion, ...await unwrap(nodeData)), target: inv.target + ' · Build-Node ' + inv.meta.nodeVersion, gaps: ['Die interne Cloudflare-Workers-Laufzeit wird vom Anbieter verwaltet.'] }; }]);
    sources.push(['mongodb-version', async () => ({ ...mongoRelease(await unwrap(mongo), JSON.parse(await read('https://downloads.mongodb.org/current.json'))), target: 'Verbundenes Produktivcluster' })]);
    sources.push(['mongodb-access', async () => databaseAccess(database)]);
    sources.push(['node-cves', async () => nvdMatches('node', process.versions.node, read)]);
    sources.push(['mongodb-cves', async () => nvdMatches('mongodb', await unwrap(mongo), read, { atlas: /\.mongodb\.net(?:[\/:?]|$)/i.test(env.MONGO_URI || '') })]);
    sources.push(['cloudflare-edge', async () => headerCheck(FRONTEND + '/', read)]);
    sources.push(['render-edge', async () => headerCheck(BACKEND + '/ready', read)]);
    return sources;
}

module.exports = { createReader, inventory, deployedFrontend, npmAdvisories, osvAdvisories, dependencyUpdates, nodeRelease, mongoRelease, nvdMatches, databaseAccess, headerCheck, createSources };
