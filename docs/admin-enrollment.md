# Betreiber-Zugang mit Einmalpasswort

Zusätzliche Admin-Konten werden in der Collection `adminaccounts` gespeichert. Die bisherigen Konten aus `ADMIN_ACCOUNTS_JSON` bzw. den Hosting-Variablen bleiben bestehen und ihre Benutzernamen sind für Einladungen reserviert. Beide Kontotypen besitzen vollständigen Admin-Zugriff.

## Bedienung

Unter `/admin` anmelden, **Zugänge** öffnen und einen Benutzernamen angeben. Das erzeugte Einmalpasswort wird nur in dieser Antwort angezeigt und gilt 48 Stunden. Der Empfänger meldet sich mit diesem Passwort an und lässt das Authenticator-Feld zunächst leer. Danach muss er ein eigenes Passwort (mindestens 16 Zeichen, höchstens 72 UTF-8-Bytes) festlegen und seinen Authenticator durch einen sechsstelligen TOTP-Code bestätigen. Erst danach erhält er eine Admin-Sitzung.

Der erste erfolgreiche Gebrauch verbraucht das Einmalpasswort atomar. Eine separate HttpOnly-Einrichtungssitzung gilt 30 Minuten und erlaubt keinen Zugriff auf Bestellungen, Produkte oder das Dashboard. Neuladen im gleichen Browser setzt die Einrichtung fort. Bei Abbruch, Ablauf oder Verlust dieser Sitzung kann ein bestehender Administrator eine **Neue Einladung** erzeugen. Sie ersetzt alte Einmalpasswörter, Einrichtungssitzungen und noch unbestätigte Faktoren. Aktive Konten können auf diesem Weg nicht überschrieben oder zurückgesetzt werden.

Für eine erstmalige Einladung ohne angemeldete Admin-Oberfläche:

```powershell
node scripts/invite-admin.js --username betreiber --out C:/PRIVATE/betreiber-einladung.txt
node scripts/invite-admin.js --username betreiber --out C:/PRIVATE/betreiber-einladung.txt --apply
```

Der erste Aufruf ist ein Dry Run. Der zweite lädt die vorhandene Backend-Umgebung, erstellt nur die Einladung und schreibt die Zugangsdaten ausschließlich in eine neue private Datei außerhalb beider Repositories. Bestehende Dateien werden nicht überschrieben. `--renew` ist nur für noch nicht aktivierte Einladungen möglich. Der Betreiber legt sein persönliches Passwort und seinen MFA-Faktor selbst auf der Website fest.

## Sicherheit und Betrieb

- Einmal- und persönliche Passwörter: bcrypt mit Kostenfaktor 12; nur Hashes werden gespeichert.
- Einrichtungssitzung: zufälliger 256-Bit-Token, nur SHA-256-Hash in MongoDB, HttpOnly-Cookie, Secure in Produktion, SameSite=Lax. CSRF-Token sind an diese Sitzung gebunden. Schreibende Routen verlangen zusätzlich eine vertrauenswürdige Origin.
- TOTP: eigener kryptografisch zufälliger Schlüssel pro Konto, lokal erzeugter QR-Code ohne Drittanbieter. AES-256-GCM verschlüsselt den Schlüssel in der Datenbank; der Kontoname ist als authentifizierte Zusatzinformation gebunden. Der Verschlüsselungsschlüssel wird per HKDF mit separatem Kontext aus `JWT_SECRET` abgeleitet.
- **Betriebliche Abhängigkeit:** `JWT_SECRET` muss zusammen mit den verschlüsselten Daten gesichert bleiben. Ein unvorbereitetes Austauschen dieses Schlüssels macht die neuen TOTP-Schlüssel unlesbar. Für eine Schlüsselrotation zuerst eine ausdrückliche Migration bzw. erneute Einrichtung planen. Bisherige Hosting-Konten bleiben davon unabhängig als administrativer Zugang verfügbar, bestehende Sitzungen werden durch JWT-Rotation ungültig.
- Aktivierung und TOTP-Verwendung erfolgen über bedingte atomare Datenbank-Updates. Ein bestätigter Zeitabschnitt wird nicht erneut akzeptiert; aktuelle und unmittelbar vorherige TOTP-Zeitabschnitte sind erlaubt. Nach dem Setup wird der verwendete Zeitabschnitt als verbraucht gespeichert.
- Einrichtung: höchstens zehn Codeversuche pro Einrichtungssitzung über alle IPs und Neustarts. Zusätzlich gilt der bestehende gemeinsame Admin-Limiter (fünf Anfragen je 15 Minuten/IP) für Anmeldung, Einladung, Passwortschritt und Codebestätigung. Einrichtungsdaten und QR-Codes werden mit `private, no-store` ausgeliefert.
- Admin-Sitzungen werden erst nach beiden Schritten erstellt und gegen einen aktiven Kontodatensatz samt Credential-Version geprüft. Listen enthalten keine Passwort-Hashes, Einmalpasswörter, Sitzungstoken oder MFA-Geheimnisse.
- Keine automatische E-Mail: Die Einladung wird vom Administrator persönlich weitergegeben. Konten-/MFA-Wiederherstellung für bereits aktive Konten ist nicht Teil dieses Einladungsablaufs.

Implementierung orientiert sich an der [otplib-Dokumentation zur sicheren Verwendung](https://otplib.yeojz.dev/guide/security) und [TOTP-Verifikation](https://otplib.yeojz.dev/api/%40otplib/totp/functions/verify.html).

## Prüfung

`test/adminEnrollment.test.js` prüft vollständige HTTP-Einrichtung, Origin/CSRF-Grenzen, vorzeitige Admin-Zugriffe, Passwortregeln, verschlüsselte Speicherung, OTP-Replay, unabhängigen vorhandenen Admin, atomaren Einmalgebrauch, parallele Aktivierung, Erneuerung, Ablauf, Versuchslimit, Abbruch und Fortbestand nach neuer Service-Instanz. Die Frontend-Suite enthält `test/admin-access.test.mjs`; ein zusätzlicher lokaler End-to-End-Lauf mit echter temporärer MongoDB wurde durchgeführt.

Deployment-Reihenfolge: Backend mit den zusätzlichen Routen veröffentlichen und Readiness prüfen, danach Frontend. Erst anschließend die echte Betreiber-Einladung anlegen. Bestehende Produkt- und Kundendaten benötigen keine Migration; die neue Collection und ihre Indizes werden beim Start initialisiert.
