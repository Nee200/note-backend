# Händlerliste und Shopnummern

Stand 10.26: `supplier-2026-10.json` enthält die 581 Zeilen der ursprünglichen Händler-PDF, einschließlich der leeren Zeilen W9 und W103. `product-supplier-2026-10.json` enthält die ausdrücklich abgeglichenen Referenzen für 578 G/L-Produkte. Der Abgleich betrifft die gespeicherten Duftbezeichnungen, nicht den tatsächlichen Flascheninhalt.

G/L bleiben stabile Shopnummern. M/W sind versionsabhängige Händlernummern. Beispielsweise gehört G1 zu M155; M1 ist G362. Orange Flamingo ist G351 / M359. M351 wurde vom Händler für Orange Cream neu belegt und bleibt auf Nutzerwunsch ausgelassen.

Bei einer neuen Händlerliste:

1. Die neue Original-PDF in eine neue versionierte Lieferantendatei übertragen. Leere Zeilen nicht aus älteren Listen auffüllen.
2. Vorhandene G/L-IDs beibehalten und Referenzen anhand von Marke, Duft und Variante abgleichen. Eine gleiche Zahl oder ähnliche Schreibweise allein genügt nicht.
3. Änderungen an Händlercodes, Duftnamen und Varianten explizit prüfen; neue Produkte erhalten freie Shopnummern. Den neuen Abgleich in einer eigenen Datei mit erwarteten Namen und Kategorien speichern und den Service auf diese Version umstellen.
4. Offene Fälle als `review`, frühere leere Referenzen als `historical` kennzeichnen. Kategorieübergreifende Namensgleichheit bestätigt nicht identische Händleröle.
5. Alle Vorwärts-/Rückwärtszuordnungen, Namensänderungen und leeren Zeilen testen. Die Browser-Testdaten mit dem neuen Stand aktualisieren und die G/L-PDF mit Originalnamen erstellen.

Der Service verweigert eine bestätigte Zuordnung, wenn sich Originalname oder Kategorie eines Shopprodukts gegenüber dem dokumentierten Abgleich geändert haben. Bestellungen erhalten für offene Fälle keine geratenen Händlercodes.
