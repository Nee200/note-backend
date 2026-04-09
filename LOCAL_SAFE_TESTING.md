# Lokaler Safe-Testmodus

Dieser Modus ist dafuer gedacht, Gutscheine, Checkout-Vorpruefung und Konto-Funktionen lokal zu testen, ohne versehentlich mit einer Remote-/Produktiv-MongoDB zu arbeiten.

## Ziel

- keine produktive MongoDB im lokalen Test
- keine echten Stripe-Checkout-Sessions im Testmodus
- kein echter E-Mail-Versand fuer Newsletter-/Pickup-Test
- Test-Gutscheincodes lokal erzeugen

## Einrichtung

1. `backend/.env.localtest.example` nach `backend/.env.localtest` kopieren
2. in `backend/.env.localtest` nur eine **lokale** MongoDB eintragen:
   - Beispiel: `mongodb://127.0.0.1:27017/note-localtest`
3. Backend mit `backend/start-local-safe.ps1` starten

## Schutzbremse

Wenn `LOCAL_DEV_SAFE_MODE=true` aktiv ist, startet das Backend **nicht**, falls `MONGO_URI` nicht auf `localhost` oder `127.0.0.1` zeigt.

## Newsletter-/Gutschein-Test

Im Safe-Mode sendet `POST /api/newsletter` keine E-Mail, sondern gibt den erzeugten Testcode direkt in der API-Antwort zurueck.

Damit kannst du lokal testen:

1. Test-E-Mail eintragen
2. erzeugten Code aus der Antwort nehmen
3. Code im Warenkorb eingeben
4. Checkout-/Pickup-Flow pruefen

## Checkout-Verhalten im Safe-Mode

- `create-checkout-session` erzeugt **keine** echte Stripe-Session
- stattdessen kommt eine sichere Test-Antwort mit berechneten Werten zurueck
- Pickup-Bestellungen versenden im Safe-Mode keine echte Bestellmail

## Wichtiger Hinweis

Den Safe-Mode nur fuer lokale Tests verwenden. Fuer spaetere Deployment-Tests wieder normale, bewusst freigegebene Umgebungsvariablen verwenden.
