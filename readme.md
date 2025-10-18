# Erstellung einer Changeset-Datenbank mit ohsome-planet

Diese Anleitung beschreibt den Workflow, um mit ohsome-planet eine Datenbank aus OpenStreetMap-Changesets und History-Daten aufzubauen. Ziel ist es, anschließend Analysen auf Changesets (z. B. über Hashtags, Nutzende oder Regionen) durchführen zu können.

---

## ⚠️ Disclaimer

Die Anleitung ist nicht vollständig, zeigt aber das grundsätzliche Vorgehen und die wichtigsten Schritte. Systemabhängigkeiten (z. B. osmium, PostgreSQL, Java) müssen vorab manuell installiert werden.

---

## 🧩 Voraussetzungen

Benötigte Tools und Bibliotheken:

- osmium-tool  
  → zum Filtern und Verarbeiten von OSM-Changesets  
  Installation:

  ```bash
  sudo apt install osmium-tool
  ```

- PostgreSQL (z. B. lokal)

- Java 17+

- ohsome-planet  
  → lokal klonen und bauen (siehe Repository: <https://github.com/GIScience/ohsome-planet>)

---

## 1. Daten herunterladen

### 1.1 OSM-History (PBF)

Lade die vollständige OSM-History-Datei (PBF) herunter.  
Für Deutschland (interner Download, ~10 GB):

<https://osm-internal.download.geofabrik.de/europe/germany.html>

### 1.2 Changesets

Lade alle aktuellen Changesets herunter – hier sind die Hashtags enthalten! (nur als Planet, ~7 GB)

<https://planet.openstreetmap.org/planet/changesets-latest.osm.bz2>

---

## 2. Changesets verarbeiten

### 2.1 Räumlich und zeitlich filtern

Mit osmium können Changesets auf Zeiträume und Regionen eingeschränkt werden.

Beispiel für Deutschland (BBox):

(⚠️ Dauer: ca. 15 Minuten – abhängig von Hardware und Datengröße.)

```bash
DE_BBOX="5.5,47.2,15.1,55.1"

osmium changeset-filter \
  --after 2020-01-01T00:00:00Z \
  --bbox $DE_BBOX \
  -o changesets-DE-2020plus.osm.bz2 \
  changesets-latest.osm.bz2
```

---

## 3. Changeset-Datenbank einrichten und befüllen

Zur Verarbeitung wird ChangesetMD verwendet: <https://github.com/ToeBee/ChangesetMD>

### 3.1 Datenbank anlegen

Erstelle eine PostgreSQL-Datenbank, z. B.:

```bash
createdb -U osm changesetmd
```

### 3.2 Tabellenstruktur anlegen

Im ChangesetMD-Verzeichnis:

```bash
cd ~/ChangesetMD
python3 changesetmd.py \
  -c \
  -H localhost \
  -u osm \
  -p osm \
  -d ch
```

### 3.3 Changeset-Datei entpacken

TODO: ggf. geht das auch ohne, wenn man noch ein zusätzliches Paket installiert (?)

```bash
bunzip2 -k ~/ohsome-planet/data/changesets-DE-2020plus.osm.bz2
```

### 3.4 Daten in die Datenbank importieren

Dauer: ca. 50 Minuten.

```bash
python3 changesetmd.py \
  -f ~/ohsome-planet/data/changesets-DE-2020plus.osm \
  -H localhost \
  -u osm \
  -p osm \
  -d changesetmd
```

### 3.5 Alternative Verarbeitung (experimentell)

Als Alternative zur ChangesetMD-basierten Variante kann osmchangesets2csv verwendet werden:

```bash
cargo install osmchangesets2csv
```

```bash
osmchangesets2csv -i changesets-DE-2020plus.osm.bz2 -o changesets-DE-2020plus.csv
```

⚠️ Hinweis: Diese Methode ist vermutlich schneller; der saubere Import in die DB funktioniert jedoch noch nicht zuverlässig.

---

## 4. Kombination von OSM-History und Changesets (ohsome-planet)

Nun können die OSM-History-Daten (.osh.pbf) und die Changesets in Parquet-Dateien zusammengeführt werden.

Beispiel:

```bash
HISTORY=~/ohsome-planet/data/germany-internal.osh.pbf
OUTDIR=~/ohsome-planet/out-germany_cs

java -Xmx16g -jar ~/ohsome-planet/ohsome-planet-cli/target/ohsome-planet.jar contributions \
  --pbf "$HISTORY" \
  --changeset-db "jdbc:postgresql://localhost:5432/changesetmd?user=osm&password=osm" \
  --output "$OUTDIR" \
  --overwrite
```

💡 Optional: Falls nur bestimmte OSM-Objekttypen (z. B. nur ways) berücksichtigt werden sollen, können zusätzliche Parameter genutzt werden (aktuell noch TODO).

---

## 5. Ergebnis

Im angegebenen Output-Verzeichnis (OUTDIR) liegen anschließend Parquet-Dateien vor, die sowohl OSM-History- als auch Changeset-Informationen enthalten – ideal für Analysen z. B. mit Spark, DuckDB oder Pandas.
