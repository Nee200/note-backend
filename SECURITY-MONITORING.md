# Sicherheitsübersicht

Die Adminansicht trennt Betriebszustand, bekannte Schwachstellen, Versionsupdates und ungeprüfte Einstellungen. Es gibt keine pauschale Sicherheitsfreigabe. Jeder Datensatz enthält den Zeitpunkt der tatsächlichen Prüfung. Nach 36 Stunden gilt er als veraltet. Bei einem Quellfehler bleiben der letzte erfolgreiche Stand und seine Befunde erhalten.

## Automatische Serverprüfung

`services/securitySources.js` gleicht das tatsächlich gestartete Backend-Lockfile und das veröffentlichte Frontend mit npm-Advisories und OSV ab, einschließlich Build-/Testpaketen. Der Frontend-Build veröffentlicht ausschließlich Commit, Lockfile-SHA256, Buildzeit und Node-Version; der Scanner prüft den Hash gegen die Lockdatei dieses unveränderlichen GitHub-Commits. Ein unbekannter oder abweichender Build wird nicht als geprüft ausgewiesen.

Node wird mit dem offiziellen Release- und Supportindex verglichen, MongoDB mit dem Herstellerindex und NVD. NVD-Treffer sind Hinweise zur Betroffenheitsprüfung. Reine Plattformvoraussetzungen mit `vulnerable:false` sind keine Lücke in Node selbst. Die dokumentierte historische Ausnahme CVE-2014-8180 gilt nur für die konkret geprüfte Atlas-Version 8.0.34; ihr Red-Hat-Satellite-6-Szenario trifft dort nicht zu.

Die tatsächlichen MongoDB-Benutzerrollen und öffentliche HTTPS-/Header-Konfiguration werden zusätzlich geprüft. Die internen Host-Patches bei Cloudflare/Render und Atlas-Konto-, Backup- und Netzwerkregeln sind damit nicht nachgewiesen.

Eine verteilte MongoDB-Lease schützt den täglichen Hintergrundscan. Er läuft unabhängig von Zahlungs- und Mailjobs; Test-/Safe-Modus führt keine externen Scans aus. GET liest nur gespeicherte Ergebnisse. Der manuelle POST benötigt Adminsession, vertrauenswürdigen Origin, CSRF und Rate Limit und reiht ausschließlich den Serverabgleich ein. Wiederholungen sind 15 Minuten gesperrt. Es werden keine Pakete im laufenden Server installiert.

## GitHub und Anbieter

Auf dem Wartungsrechner mit vorhandenem `gh`-Login:

```powershell
node scripts/refresh-github-security.js
node scripts/refresh-github-security.js --write
```

Ohne `--write` erfolgt nur ein lesender GitHub-Abgleich. Mit `--write` wird ausschließlich die Sammlung `securitystatuses` über den konfigurierten Datenbankzugang aktualisiert. Kein GitHub-Token wird auf Render kopiert. Secret-Werte werden bereits durch die `gh`-Feldauswahl ausgeschlossen. Offene Dependabot-, CodeQL- und Secret-Scanning-Befunde sowie Aktivierungszustände werden erfasst; Fehler dürfen sie nicht löschen. CodeQL-Befunde werden fachlich bewertet, echte Schwachstellen korrigiert und nach erneuter Analyse geschlossen. Falschmeldungen benötigen eine konkrete Begründung.

Die CodeQL-Abdeckung benötigt erfolgreiche Analysen für JavaScript/TypeScript und GitHub Actions auf demselben aktuellen `main`-Commit. Ein einzelner erfolgreicher Teilscan reicht nicht; ein später fehlgeschlagener Scan bleibt sichtbar. Noch offene GitHub-Meldungen aus älteren Analysen werden bis zum bestätigten neuen Ergebnis beibehalten, auch wenn der geprüfte PR die Korrektur bereits enthält.

Manuelle Anbieterprüfungen können als JSON-Array mit `key`, tatsächlichem `checkedAt` und `data` importiert werden: `--write --provider-review ABSOLUTER_PFAD`. Zulässige Schlüssel: `cloudflare-config`, `render-config`, `mongodb-config`. `data` enthält `summary`, `checks`, `findings`, `gaps`, `links` und optional `target`. Keine Zugangsdaten oder Kundendaten eintragen. Ungeprüfte Aspekte unter `gaps` belassen; ein erneuter Import darf den ursprünglichen Prüfzeitpunkt nicht erneuern.

Der lokale Wartungsauftrag aktualisiert GitHub-Berichte täglich und prüft Anbieterzugänge. Er benötigt den eingeschalteten/verfügbaren Wartungsrechner und gültige Sitzungen. Bei Ausfall wird der Stand sichtbar veraltet. Serverseitiger Scanner, tägliche CI und Dependabot laufen unabhängig davon weiter.

## Patchablauf

Dependabot prüft täglich; beide CI-Workflows laufen bei PRs, Pushes und täglich inklusive vollständigem npm-Audit. Sicherheitskorrekturen und kompatible Updates werden im Branch vorgenommen, mit passenden Tests geprüft, als PR veröffentlicht und erst nach erfolgreichen Prüfungen ausgerollt. Anschließend tatsächliche Deployment-Revision und Laufzeit prüfen und erneut scannen. Größere API-/Framework-Wechsel gesondert planen. Schlüsselwiderrufe, MFA, Netzwerkzugänge und Datenbankmigrationen benötigen eine koordinierte Umstellung; offene Punkte nicht als behoben ausgeben.
