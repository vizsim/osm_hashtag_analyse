# #missing-cw_mapillary-signs – Analyse von Radinfrastruktur-Ergänzungen in OSM

Dieses Repository analysiert Änderungen in OpenStreetMap, die im Zusammenhang mit dem Hashtag  
**`#missing-cw_mapillary-signs`** vorgenommen wurden.

Der Fokus liegt darauf zu verstehen,

- welche Art von Radinfrastruktur durch diese Änderungen neu entstanden ist,
- welche bestehenden Wege lediglich präzisiert wurden,
- und wie sich unklare oder fehlende Tags zu expliziter Radinfrastruktur entwickelt haben.

---

## Hintergrund

Der Hashtag **`#missing-cw_mapillary-signs`** wird verwendet, wenn auf Basis von Mapillary-Bildern
fehlende oder unvollständige Radverkehrs-Tags ergänzt werden.

Typische Fälle sind:
- fehlende `cycleway=*`-Tags an Straßen,
- fehlende `bicycle=yes` oder `bicycle=designated`-Tags auf separaten Wegen,
- Präzisierungen bestehender, aber uneindeutiger Infrastruktur.

Die Änderungen repräsentieren damit keine zufälligen Edits, sondern gezielte Verbesserungen der
Abbildung von Radinfrastruktur in OSM.

---

## Datenbasis

Die Analyse basiert auf:

- ohsome Planet-Extraktionen (Full-History)
- Filterung nach Changesets mit dem Hashtag  
  `#missing-cw_mapillary-signs`
- Betrachtung ausschließlich positiver Längenänderungen  (TODO: Disclaimer von Längenänderungen formulieren!)
  (neu hinzugefügte oder präzisierte Infrastruktur)

Untersucht wird die Entwicklung von **Source-Tags → Target-Tags**.

---

## Methodik

1. **Extraktion**
   - Änderungen werden aus dem ohsome Planet extrahiert
   - Aggregation nach Quell- und Ziel-Tags

2. **Klassifikation**
   - *Sources (links)*: Zustand vor der Änderung  
   - *Targets (rechts)*: Zustand nach der Änderung

3. **Visualisierung**
   - Sankey-Diagramme zur Darstellung von Tag-Übergängen
   - Karten zur räumlichen Einordnung der Änderungen

---

![alt text](sankey.png)

## Interpretation der Visualisierungen

### Sankey-Diagramm

Die Pfeile zeigen, wie Straßen-Tags in Radinfrastruktur-Tags umgewandelt wurden:

- **Targets (rechts):** Alle Wege nach der Änderung mit expliziter Radinfrastruktur-Tagung (z.B. `cycleway=track`)

- **`Added` (von links):** Komplett neu hinzugefügte Wege als Radinfrastruktur

- **Andere Sources (von links):** Bestehende Wege, deren Radinfrastruktur-Tags präzisiert wurden (z.B. `bicycle=yes` → `cycleway=designated`)

- **`(other)` (von links):** Wege ohne klare Radinfrastruktur-Tagung zuvor – typischerweise fehlte `cycleway=*`, `bicycle=yes` oder `bicycle=designated`

---

## Interaktive Ergebnisse

GitHub READMEs unterstützen keine interaktiven Plotly-Diagramme direkt.  
Die interaktiven Visualisierungen werden daher über **GitHub Pages** bereitgestellt.

- **Interaktives Sankey-Diagramm:**  
  https://vizsim.github.io/osm_hashtag_analyse/analysen/cw_miss/sankey.html

- **Interaktive Karte:**  
  https://vizsim.github.io/osm_hashtag_analyse/analysen/cw_miss/gdf_categories_v2.html


---
