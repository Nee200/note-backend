# Backend-Deployment

Stand: 5. September 2026. Quelle: `https://github.com/Nee200/note-backend.git`. Hosting-Konfiguration ist für Render vorgesehen; diese Dokumentation bestätigt keinen erfolgten Produktivwechsel.

## Installation und Start

- Runtime: Node.js **24.20.0 oder eine neuere 24.x-Version**; Produktionsstart mit älterer oder anderer Hauptversion wird abgewiesen.
- Installationsbefehl: `npm ci --omit=dev`.
- Startbefehl: `node server.js`.
- Readiness im Hosting: `/ready`; `/health` bestätigt den laufenden Prozess und enthält den DB-Verbindungsstatus.
- Beim Start werden Modellindizes initialisiert, bevor der HTTP-Port geöffnet wird. Ein Indexfehler muss behoben werden; nicht durch Abschalten der Eindeutigkeitsregeln umgehen.

In Render ausdrücklich `NODE_VERSION=24.20.0` setzen. Eine bereits konfigurierte Variable hat Vorrang vor `.node-version` und `package.json`. Das entspricht der [Render-Dokumentation zur Node-Version](https://render.com/docs/node-version).

## Produktionskonfiguration

Die versionierte `.env.production.example` beschreibt die Felder, enthält aber keine verwendbaren Geheimnisse. Produktive Werte gehören in den Secret-/Environment-Bereich des Hostings. `server.js` lädt genau eine ausdrücklich gewählte `DOTENV_CONFIG_PATH` oder die lokale `.env`; schon gesetzte Prozessvariablen werden nicht überschrieben.

| Einstellung | Zweck |
|---|---|
| `NODE_ENV=production` | Sichere Cookies, strenge Konfigurationsprüfung, Admin-MFA |
| `MONGO_URI` | Anwendungsdatenbank mit ausdrücklich benanntem DB-Namen; eigener Benutzer mit passenden Rechten |
| `JWT_SECRET` | Zufälliger Schlüssel mit mindestens 32 Bytes; Rotation meldet bestehende Sitzungen ab |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_TOTP_SECRET` | Benannter Administrator, mindestens 16 Passwortzeichen, eingerichteter TOTP-Faktor mit Base32-Secret ab 32 Zeichen |
| `ADMIN_ACCOUNTS_JSON` | Alternative für persönliche Admin-Konten: Array aus `username`, `passwordHash` oder `password`, `totpSecret`; maximal 20 Konten |
| `PROXY_SHARED_SECRET` | Mindestens 32 zufällige Bytes, exakt derselbe Wert im Cloudflare Worker; authentifiziert weitergereichte Client-IP-Adressen |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` | Separater, langlebiger Schlüssel ab 32 Bytes für Abmeldelinks; nicht routinemäßig zusammen mit JWT wechseln |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Richtiger Stripe-Account und Live-Modus; Webhook-Secret des konkreten Endpunkts |
| `RESEND_API_KEY` | Verifizierter Mailversand für die verwendete Absenderdomain |
| `FRONTEND_PUBLIC_URL` | `https://note-fragrances.de` |
| `BACKEND_PUBLIC_URL` | Tatsächliche Render-Adresse; derzeit als Vorgabe `https://note-backend-5gy0.onrender.com` |
| `TRUSTED_BROWSER_ORIGINS` | Zusätzliche ausdrücklich erlaubte Origins, kommasepariert; keine beliebigen Wildcards |
| `INVOICES_ENABLED` | Standard `true`; mit `false` Rechnungserstellung und Hintergrundreparatur pausieren und Rechnungstab ausblenden |
| `INVOICE_*`, `ORDER_SEQUENCE_START` | Geprüfte Ausstellerdaten, Nummernkreise, Steuersatz und Anfangsnummern aus der Beispieldatei |

Ein TOTP-Secret muss mit dem vorgesehenen Authenticator eingerichtet und sicher hinterlegt werden. Der Code erzeugt kein unbekanntes Ersatzkonto. Für mehrere Personen jeweils eigene Konten verwenden. Passwort-/TOTP-Änderungen machen vorhandene Admin-Sitzungen durch einen Konfigurationsfingerabdruck ungültig. Ein TOTP-Zeitfenster kann nur einmal zur Anmeldung verwendet werden.

Für diesen Shop sind zwei unabhängige Konten mit vollständigem Admin-Zugriff vorgesehen: `betreiber` und `admin`. Die Beispieldatei verwendet dafür `ADMIN_ACCOUNTS_JSON` mit jeweils eigenem bcrypt-Passworthash und eigenem TOTP-Secret. Die Bezeichnungen können vor dem Einrichten angepasst werden. Die Konfiguration weist wiederverwendete TOTP-Secrets und doppelte Benutzernamen ab. Eine Abmeldung betrifft nur die betreffende Sitzung; die Rotation der Zugangsdaten eines Kontos verändert den Konfigurationsfingerabdruck des anderen Kontos nicht. Beide Personen müssen ihren eigenen Authenticator vor der Aktivierung eingerichtet und die Anmeldung erfolgreich geprüft haben. Die Beispielwerte sind keine eingerichteten Zugänge.

`LOCAL_DEV_SAFE_MODE` und `CHECKOUT_DRY_RUN` müssen in Produktion ausgeschaltet sein. Für isolierte Tests sind nur Loopback-Datenbanken mit `note-test…`, `note-localtest…` oder `note-audit…` erlaubt. Die vier Testprodukte dürfen nicht als produktiver Katalog importiert werden.

## Stripe-Endpunkt und Verarbeitung

Stripe ruft direkt `https://<backend-host>/webhook` auf. Die unveränderten Request-Bytes werden mit dem Stripe-SDK geprüft; ein fehlgeschlagener Verarbeitungsschritt liefert HTTP 503 und bleibt zusätzlich in MongoDB wiederholbar gespeichert. Ein gültiges Ereignis aus dem falschen Live-/Testmodus wird abgewiesen.

Folgende Ereignisse am Endpunkt abonnieren:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
```

Bezahlstatus und Positionen werden aus Stripe nachgeladen; alle Positionenseiten werden abgeholt und Summen geprüft. Mehrfachzustellung und verspätete Ereignisse sind berücksichtigt. Offene lokale Checkout-Vorgänge werden ab 30 Minuten zusätzlich gegen Stripe abgeglichen. Ein Providerfehler mit unbekanntem Ausgang gibt einen Gutschein nicht unkontrolliert frei. Nach 23 Stunden ohne eindeutig bestätigtes Ergebnis entsteht Prüfbedarf.

Ein einzelner dauerhafter Hintergrundlauf bearbeitet alle 30 Sekunden begrenzte Stapel: Webhooks, Bestellbenachrichtigungen, Rechnungsreparatur, Newsletter, Mailqueue und Checkout-Abgleich. Datenbank-Leases und eindeutige Schlüssel verhindern parallele Doppelverarbeitung. Der Dienst muss tatsächlich laufen, damit Wiederholungen stattfinden. Bei einer pausierten oder schlafenden Hosting-Instanz kann sich die Bearbeitung verzögern.

## Mail und Betriebszustand

`accepted` bedeutet, dass Resend den Auftrag angenommen hat. Es ist kein Nachweis der Zustellung im Postfach. Providerfehler bleiben mit Wiederholungszeit gespeichert. Nach Ablauf des sicheren Wiederholungsfensters bleibt ein unklarer Auftrag in `manual_review`; den Providerstatus zuerst abgleichen. Resend dokumentiert ein [Idempotenzfenster von 24 Stunden](https://resend.com/docs/dashboard/emails/idempotency-keys); die Anwendung setzt hierfür eine konservative Grenze von 23 Stunden.

Im Admin-Monitoring werden Datenbankzustand und tatsächliche Rückstände angezeigt. Der Bereich ist keine Sicherheitszertifizierung. Dependency-Scans laufen in CI, nicht im Webprozess. Das Aktionsprotokoll ist authentifiziert unter `/api/admin/audit?page=1` abrufbar; Bestell-/Rechnungslisten sind ebenfalls paginiert. Ein externer Uptime-Alarm ist im Hosting einzurichten und anhand eines echten Alarms zu verifizieren.

## Vor dem Wechsel

1. Aktuelles verschlüsseltes Backup erstellen und Wiederherstellung unter anderem Datenbanknamen prüfen.
2. Bestehende Nummernkreise, Ausstellerdaten und produktive Katalog-/Bestelldaten inventarisieren. Eine Diagnose ohne Geschäftsdatenschreibzugriffe ist möglich:

   ```powershell
   node scripts/audit-data.js --env C:/Secure/note-production.env --out C:/Secure/note-data-audit.json
   ```

   Die Datei enthält Bestandszahlen und den DB-Namen, keine Kundenlisten. Der Befehl führt keinen Stripe-Abgleich durch und deaktiviert automatische Collection-/Indexerstellung für diesen Diagnoselauf.

3. Backend und neuen Frontend-Worker in einer Testumgebung zusammen abnehmen. Der neue Cookie-/CSRF-Vertrag benötigt beide Komponenten.
4. Danach die festgehaltenen Commit-Stände im Hosting auswählen. Nach dem Wechsel neu anmelden; alte JWTs ohne serverseitige Sitzung werden absichtlich nicht übernommen.
5. `/ready`, Admin-MFA, Kunden-Verifizierung, Checkout, echte Webhook-Zustellung, Mailannahme und Queue-Rückstände prüfen. Keine Test-Smokes mit schreibenden synthetischen Daten gegen Produktion ausführen.

Historische Bestellungen erhalten keine pauschale Besitzerzuordnung und keine erfundenen Versanddaten. Alte E-Mail-Bestätigungen werden beim erneuten Stripe-Ereignis nicht blind nochmals versendet. Bestehende Rechnungen werden bei fehlender Verknüpfung wieder zugeordnet; eine Rechnung wird dafür nicht neu ausgestellt. Unbekannte Alt-Gutscheinreservierungen, externe Kassenbelege und Erstattungsbelege benötigen einen konkreten Datenabgleich.

Die Kategorie `car-fragrance` des bestehenden Autoduft-Katalogs bleibt gültig; `autoduft` wird ebenfalls akzeptiert. Eine Katalogmigration ist hierfür nicht erforderlich. Die eindeutigen Sparse-Indizes für Stripe-Sessions und Gutscheincodes haben die ausdrücklichen Namen `stripe_session_unique_sparse` und `subscriber_code_unique_sparse`. Damit kollidieren sie nicht mit den früheren Definitionen `stripeSessionId_1` und `code_1`. Die alten Indizes werden nicht automatisch gelöscht. Beim ersten Start legt die Anwendung die noch fehlenden neuen Indizes an; doppelte Werte müssen vorher geprüft sein. Dieser Übergang ist mit synthetischen Datensätzen und den bisherigen Indexdefinitionen unter MongoDB 8.2.6 getestet.

## Wartung und Rückweg

Die Import-/Preisskripte arbeiten standardmäßig als Trockenlauf. Ein Schreibaufruf benötigt ausdrücklich `--apply` oder beim alten Rechnungsskript `--execute` sowie `--database <exakter-name>` und `--host <exakter-host>`. Die Skripte laden keine beliebige `.env` nebenbei. Vor Schreibläufen das Ziel und die ausgegebenen Änderungen prüfen.

Bei Problemen zunächst Zahlungsannahme kontrolliert pausieren und Fehler beheben. Ein Code-Rollback muss Backend und Frontend gemeinsam berücksichtigen. Die Datenbank nicht pauschal auf den Stand vor dem Release zurücksetzen: zwischenzeitliche Bestellungen, Zahlungen und unveränderliche Belege müssen erhalten bleiben. Alte Software sollte die neuen Zahlungszustände nicht weiterbearbeiten.

Prüfung dieses Stands: `npm ci`, `npm run test:syntax`, `npm test`, `npm audit`. Die GitHub-Workflow-Datei ist `.github/workflows/ci.yml`; die jeweils zum Commit gehörenden Ergebnisse sind am [Backend-PR #1](https://github.com/Nee200/note-backend/pull/1) sichtbar. Die lokale Suite umfasst nach den Ergänzungen zur Bestandskompatibilität und den zwei Admin-Konten 29 erfolgreiche Tests.
