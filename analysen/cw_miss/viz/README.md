# Sankey + MapLibre Viz

Diese Visualisierung verbindet ein Sankey-Diagramm mit einer interaktiven Karte auf Basis derselben Strict-Transitionsdaten. Auswahl im Diagramm und Darstellung auf der Karte bleiben direkt miteinander gekoppelt.

## Visualisierung

Live-Version:
<https://vizsim.github.io/osm_hashtag_analyse/analysen/cw_miss/viz/>

## Datenbasis

Die Ansicht verwendet drei vorbereitete Dateien aus dem Preprocessing:

- `./preprocessing/data/sankey.json`
- `./preprocessing/data/transitions_index.json`
- `./preprocessing/data/transitions.pmtiles` (erzeugt via `./preprocessing/generate_pmtiles.sh`)

Das PMTiles-Archiv wird nicht von GitHub Pages ausgeliefert, sondern von
`raw.githubusercontent.com` (siehe `config.js`). Pages komprimiert
`application/octet-stream` on the fly und beantwortet Range-Requests mit einem
Ausschnitt der *komprimierten* Datei; Browser, die bei Range-Requests kein
`Accept-Encoding: identity` senden (Firefox vor 148, Mozilla-Bug 1983387),
bekommen dadurch unbrauchbare Bytes. Auf `localhost` wird weiterhin die lokale
Datei genutzt.


## Interaktion

- Klick auf einen linken Knoten filtert nach `source`.
- Klick auf einen rechten Knoten filtert nach `target`.
- Klick auf einen Flow filtert auf genau diese `source -> target`-Kombination.
- `Reset` setzt die Gesamtauswahl zurueck.
- Bei kleinerem Zoom werden Geometrien aggregiert als Punkte dargestellt.
- Klick auf ein Kartenelement oeffnet den zugehoerigen OSM-Way.

## Technischer Stand

Die Geometrien liegen als PMTiles vor und werden per Byte-Range direkt im Browser gelesen. Der Host muss dafuer Byte-Serving ohne Kompressions-Transformation beherrschen — jsDelivr scheidet damit aus, es liefert brotli-kodierte Ranges.
