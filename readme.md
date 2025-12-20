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

### 1.1 OSM-History (.osh.pbf) 

Lade die vollständige OSM-History-Datei (.osh.pbf) herunter.  
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

( Dauer: ⏱️ ca. 15 Minuten – abhängig von Hardware und Datengröße.)

```bash
DE_BBOX="5.5,47.2,15.1,55.1"

osmium changeset-filter \
  --after 2025-01-01T00:00:00Z \
  --bbox $DE_BBOX \
  -o changesets-DE-2025plus251201.osm.bz2 \
  changesets-251201.osm.bz2 
```

---

## 3. Changeset-Datenbank einrichten und befüllen

Zur Verarbeitung wird **ChangesetMD** verwendet:  
https://github.com/ToeBee/ChangesetMD

---

### 3.1 In ChangesetMD wechseln und Python-Umgebung vorbereiten

```bash
cd ~/ChangesetMD
```

**Wenn die virtuelle Umgebung bereits existiert:**

```bash
source .venv/bin/activate
```

**Falls sie noch nicht existiert:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install \
  bz2file==0.98 \
  lxml==6.0.2 \
  psycopg2-binary==2.9.11 \
  PyYAML==6.0.3
```

---

### 3.2 PostgreSQL-Datenbank anlegen

```bash
createdb -U osm -h localhost -W ch_2025_12
```

---

### 3.3 Tabellenstruktur anlegen

```bash
python3 changesetmd.py \
  -c \
  -H localhost \
  -u osm \
  -p osm \
  -d ch_2025_12
```

---

### 3.4 Changeset-Daten importieren

Direkter Import der `.osm.bz2`-Datei  
(kein vorheriges Entpacken nötig, Deutschland 01.01.2025–01.12.2025 ⏱️ ca. 10 Minuten)

```bash
python3 changesetmd.py \
  -f ~/ohsome-planet/data/changesets-DE-2025plus251201.osm.bz2 \
  -H localhost \
  -u osm \
  -p osm \
  -d ch_2025_12
```

---

## 4. Kombination von OSM-History und Changesets (ohsome-planet)

Nun können die OSM-History-Daten (.osh.pbf) und die Changesets in Parquet-Dateien zusammengeführt werden.

**Hinweis:** Mit `--include-tags=foobar123` werden alle Relations ausgeschlossen (da nicht benötigt). Die Verarbeitung dauert ⏱️ ca. 1 Stunde.

Beispiel:

```bash
HISTORY=~/ohsome-planet/data/germany-internal.osh.pbf
OUTDIR=~/ohsome-planet/out-germany_cs_251201

java -Xmx16g -jar ~/ohsome-planet/ohsome-planet-cli/target/ohsome-planet.jar contributions \
  --pbf "$HISTORY" \
  --changeset-db "jdbc:postgresql://localhost:5432/ch_2025_12?user=osm&password=osm" \
  --output "$OUTDIR" \
  --include-tags=foobar123 \
  --overwrite
```  

---

## 5. Ergebnis

Im angegebenen Output-Verzeichnis (OUTDIR) liegen anschließend Parquet-Dateien vor, die sowohl OSM-History- als auch Changeset-Informationen enthalten – ideal für Analysen z. B. mit Spark, DuckDB oder Pandas.

Diese Parquet-Dateien werden anschließend im `analysen`-Folder für weitere Datenanalysen und Visualisierungen genutzt.
