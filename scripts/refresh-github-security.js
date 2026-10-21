// Run on the maintenance computer with its existing gh login. No GitHub token is copied to production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const { saveSource } = require('../services/securityMonitor');
const SecurityStatus = require('../models/SecurityStatus');
const REPOSITORIES = ['note-backend', 'note-frontend'];

function api(endpoint, jq = '.', paginate = false) {
    try {
        const output = execFileSync('gh', ['api', endpoint, ...(paginate ? ['--paginate'] : []), '--jq', paginate ? '(' + jq + ')[] | @json' : jq], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8000000, stdio: ['ignore', 'pipe', 'pipe'] });
        return paginate ? output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(output);
    } catch { const error = Error('GitHub-Quelle nicht erreichbar oder erforderliches Leserecht fehlt: ' + endpoint.split('?')[0]); error.code = 'GITHUB_SOURCE'; throw error; }
}
function readGitHub(repository, call = api) {
    if (!REPOSITORIES.includes(repository)) throw Error('Repository nicht freigegeben.');
    const base = 'repos/Nee200/' + repository;
    const repo = call(base, '{security_and_analysis,default_branch}');
    const revision = call(base + '/commits/main', '{sha}').sha;
    const fixes = call(base + '/automated-security-fixes');
    const codeql = call(base + '/code-scanning/default-setup');
    const analyses = call(base + '/code-scanning/analyses?ref=refs/heads/main&per_page=30', 'map({commit_sha,created_at,error,tool:.tool.name})');
    const dependabot = call(base + '/dependabot/alerts?state=open&per_page=100', 'map({number,html_url,package:.dependency.package.name,scope:.dependency.scope,summary:.security_advisory.summary,severity:.security_advisory.severity,ghsa:.security_advisory.ghsa_id,cve:.security_advisory.cve_id,fix:.security_vulnerability.first_patched_version.identifier})', true);
    const code = call(base + '/code-scanning/alerts?state=open&per_page=100', 'map({number,html_url,rule:.rule.id,severity:.rule.security_severity_level,description:.rule.description,path:.most_recent_instance.location.path,line:.most_recent_instance.location.start_line,commit:.most_recent_instance.commit_sha})', true);
    // Only these fields leave gh. In particular: never collect the exposed secret itself.
    const secrets = call(base + '/secret-scanning/alerts?state=open&per_page=100', 'map({number,html_url,type:.secret_type_display_name})', true);
    for (const rows of [dependabot, code, secrets]) if (!Array.isArray(rows) || rows.length > 1000) throw Error('GitHub-Auswertung unvollständig.');
    const findings = [
        ...dependabot.map(row => ({ id: row.ghsa || row.cve || 'dependabot-' + row.number, title: row.summary, severity: row.severity, package: row.package, scope: row.scope, detail: row.fix ? 'Erste Fix-Version: ' + row.fix : 'Fix im Advisory prüfen.', url: row.html_url, state: 'affected-version' })),
        ...code.map(row => ({ id: 'codeql-' + row.number, title: row.description, severity: row.severity || 'unknown', detail: `${row.rule} · ${row.path}:${row.line} · Analyse ${String(row.commit || '').slice(0, 12)}`, url: row.html_url, state: 'review' })),
        ...secrets.map(row => ({ id: 'secret-' + row.number, title: 'Offene Secret-Scanning-Meldung: ' + row.type, severity: 'high', detail: 'Schlüssel beim Anbieter prüfen und bei Bestätigung widerrufen/rotieren. Der Schlüssel wird hier nie gespeichert.', url: row.html_url, state: 'review' }))
    ];
    const checks = [
        { label: 'Dependabot-Warnungen lesbar', ok: true },
        { label: 'Dependabot-Sicherheitsupdates aktiviert', ok: fixes.enabled === true && !fixes.paused },
        { label: 'CodeQL aktiviert', ok: codeql.state === 'configured' },
        { label: 'CodeQL-Analyse für aktuellen main-Commit', ok: analyses.some(row => row.commit_sha === revision && !row.error) },
        { label: 'Secret Scanning aktiviert', ok: repo.security_and_analysis?.secret_scanning?.status === 'enabled' },
        { label: 'Push-Schutz für Secrets aktiviert', ok: repo.security_and_analysis?.secret_scanning_push_protection?.status === 'enabled' }
    ];
    return { target: `Nee200/${repository} · main ${revision}`, summary: 'Authentifizierter GitHub-Abgleich: offene Dependabot-, CodeQL- und Secret-Meldungen. CodeQL-/Secret-Hinweise müssen fachlich bewertet werden. Sammlung über den lokalen Wartungszugang.', checks, findings,
        gaps: checks.filter(row => !row.ok).map(row => row.label + ': noch nicht nachgewiesen.'),
        links: ['https://github.com/Nee200/' + repository + '/security'] };
}

async function main() {
    const write = process.argv.includes('--write');
    const results = [];
    if (write) {
        const env = require('../config/environment').loadEnvironment({ ...process.env });
        if (!env.MONGO_URI) throw Error('Datenbankzugang fehlt.');
        await require('mongoose').connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
        await SecurityStatus.init();
    }
    try {
        for (const repository of REPOSITORIES) {
            const key = repository.replace('note-', 'github-');
            if (write) {
                const ok = await saveSource(key, async () => readGitHub(repository));
                results.push({ key, saved: ok });
                if (!ok) process.exitCode = 1;
            } else results.push({ key, checkedAt: new Date().toISOString(), data: readGitHub(repository) });
        }
        const reviewIndex = process.argv.indexOf('--provider-review');
        if (reviewIndex !== -1) {
            if (!write) throw Error('Provider-Bericht erfordert --write.');
            const reviews = JSON.parse(await fs.readFile(process.argv[reviewIndex + 1], 'utf8'));
            for (const review of reviews) {
                if (!['cloudflare-config', 'render-config', 'mongodb-config'].includes(review.key) || !Number.isFinite(Date.parse(review.checkedAt)) || Date.parse(review.checkedAt) > Date.now() || !review.data?.summary) throw Error('Provider-Bericht ungültig.');
                await saveSource(review.key, async () => review.data, { now: () => new Date(review.checkedAt) });
                results.push({ key: review.key, saved: true });
            }
        }
        console.log(JSON.stringify(results, null, 2));
    } finally { if (write) await require('mongoose').disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.code === 'GITHUB_SOURCE' ? error.message : 'Sicherheitsabgleich fehlgeschlagen. Zugang und Quellen prüfen; keine Freigabe erteilt.'); process.exitCode = 1; });
module.exports = { readGitHub };
