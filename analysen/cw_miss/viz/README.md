# Sankey + MapLibre Viz

Diese Visualisierung verbindet ein Sankey-Diagramm mit einer interaktiven Karte auf Basis derselben Strict-Transitionsdaten. Auswahl im Diagramm und Darstellung auf der Karte bleiben direkt miteinander gekoppelt.

## Visualisierung

Live-Version:
<https://vizsim.github.io/osm_hashtag_analyse/analysen/cw_miss/viz/>

## Datenbasis

Die Ansicht verwendet aktuell zwei vorbereitete Dateien aus dem Preprocessing:

- `./preprocessing/data/sankey.json`
- `./preprocessing/data/transitions_strict.geojson`


## Interaktion

- Klick auf einen linken Knoten filtert nach `source`.
- Klick auf einen rechten Knoten filtert nach `target`.
- Klick auf einen Flow filtert auf genau diese `source -> target`-Kombination.
- `Reset` setzt die Gesamtauswahl zurueck.
- Bei kleinerem Zoom werden Geometrien aggregiert als Punkte dargestellt.
- Klick auf ein Kartenelement oeffnet den zugehoerigen OSM-Way.

## Technischer Stand

Die aktuelle Version nutzt GeoJSON direkt und ist fuer den aktuellen Datenumfang ausreichend leichtgewichtig. Fuer groessere Datenmengen kann spaeter auf PMTiles oder Vektor-Tiles umgestellt werden, ohne die fachliche Datenbasis zu aendern.
