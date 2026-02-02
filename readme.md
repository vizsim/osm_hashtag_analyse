# Erstellung einer Changeset-Datenbank mit ohsome-planet

Diese Anleitung beschreibt den Workflow, um mit ohsome-planet eine Datenbank aus OpenStreetMap-Changesets und History-Daten aufzubauen. Ziel ist es, anschließend Analysen auf Changesets (z. B. über Hashtags, Nutzende oder Regionen) durchführen zu können.

---

## 📑 Inhaltsverzeichnis

* [Disclaimer](#-disclaimer)
* [Voraussetzungen](#-voraussetzungen)
1. [Daten herunterladen](#1-daten-herunterladen)
2. [Changesets verarbeiten](#2-changesets-verarbeiten)
3. [Changeset-Datenbank einrichten und befüllen](#3-changeset-datenbank-einrichten-und-befüllen)
4. [Kombination von OSM-History und Changesets](#4-kombination-von-osm-history-und-changesets-ohsome-planet-inkl-replikation)
5. [Ergebnis](#5-ergebnis)
* [Troubleshooting & Tipps](#-troubleshooting--tipps)
* [Weiterführende Links](#-weiterführende-links)

---

## ⚠️ Disclaimer

Die Anleitung ist nicht vollständig, zeigt aber das grundsätzliche Vorgehen und die wichtigsten Schritte. Systemabhängigkeiten (z. B. osmium, PostgreSQL, Java) müssen vorab manuell installiert werden.

---

## 🧩 Voraussetzungen

Benötigte Tools und Bibliotheken:

- osmium-tool  
  → zum Filtern und Verarbeiten von OSM-Changesets  
  Installation:
  ```sudo apt install osmium-tool```
- PostgreSQL (z. B. lokal)
- Docker (für einfache DB-Einrichtung)
- Java 17+

- ohsome-planet  (v 1.2.0)
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
  -o changesets-DE-2025plus260126.osm.bz2 \
  changesets-260126.osm.bz2 
```

---

## 3. Changeset-Datenbank einrichten und befüllen (NEU seit 1.2.0)

### 3.1 PostgreSQL-Datenbank anlegen (mit Docker)

```bash
export OHSOME_PLANET_DB_USER=ohsomedb
export OHSOME_PLANET_DB_PASSWORD=mysecretpassword

 docker run -d \
  --name ohsome_planet_changeset_db \
  -e POSTGRES_PASSWORD=$OHSOME_PLANET_DB_PASSWORD \
  -e POSTGRES_USER=$OHSOME_PLANET_DB_USER \
  -p 5433:5432 \
  postgis/postgis
```

---

### 3.2 Changeset-Daten importieren

Direkter Import der `.osm.bz2`-Datei  
(kein vorheriges Entpacken nötig, Deutschland 01.01.2025– ⏱️ ca. 5 Minuten)

```bash
java -jar ohsome-planet-cli/target/ohsome-planet.jar \
  changesets \
  --bz2 data/changesets-DE-2025plus260126.osm.bz2 \
  --changeset-db "jdbc:postgresql://localhost:5433/postgres?user=$OHSOME_PLANET_DB_USER&password=$OHSOME_PLANET_DB_PASSWORD" \
  --create-tables \
  --overwrite
```

---

## 4. Kombination von OSM-History und Changesets (ohsome-planet) inkl. Replikation

Nun können die OSM-History-Daten (.osh.pbf) und die Changesets in Parquet-Dateien zusammengeführt und die Replikation vorbereitet werden.

Für den Download aus dem internen Geofabrik-Bereich ist eine automatisierte Authentifizierung erforderlich ([OAuth-API](https://github.com/geofabrik/sendfile_osm_oauth_protector/blob/master/doc/client.md)).


**Hinweis:** Mit `--include-tags=foobar123` werden alle Relations ausgeschlossen (da nicht benötigt). Die Verarbeitung dauert ⏱️ ca. 1 Stunde.

Initiale Erstellung:
```bash
export OHSOME_PLANET_DB_USER=ohsomedb
export OHSOME_PLANET_DB_PASSWORD=mysecretpassword
export OHSOME_PLANET_DB_SCHEMA=public
export OHSOME_PLANET_DB_POOLSIZE=100

export OSM_REPLICATION_ENDPOINT_COOKIE="$(cut -d';' -f1 ~/sendfile_osm_oauth_protector/cookie.txt)"

java -jar ohsome-planet-cli/target/ohsome-planet.jar contributions \
  --data ~/ohsome-planet/data/germany_from2025_rep \
  --pbf  ~/ohsome-planet/data/germany-internal.osh.pbf \
  --filter-relation-tag-keys=foobar123 \
  --changeset-db "jdbc:postgresql://localhost:5433/postgres?user=$OHSOME_PLANET_DB_USER&password=$OHSOME_PLANET_DB_PASSWORD" \
  --replication-endpoint "https://osm-internal.download.geofabrik.de/europe/germany-updates"
```  
Replikation:

```bash
java -jar ohsome-planet-cli/target/ohsome-planet.jar replications \
  --data ~/ohsome-planet/data/germany_from2025_rep \
  --changeset-db "jdbc:postgresql://localhost:5433/postgres?user=$OHSOME_PLANET_DB_USER&password=$OHSOME_PLANET_DB_PASSWORD" \
  -v
```
---


## 5. Ergebnis

Im angegebenen Output-Verzeichnis (`--data`) liegen anschließend Parquet-Dateien vor, die sowohl OSM-History- als auch Changeset-Informationen enthalten – ideal für Analysen z. B. mit Spark, DuckDB oder Pandas.

Diese Parquet-Dateien werden anschließend im `analysen`-Ordner für weitere Datenanalysen und Visualisierungen genutzt.

---

---

## 🔗 Weiterführende Links

- [ohsome-planet Doku](https://github.com/GIScience/ohsome-planet)
- [osmium-tool](https://osmcode.org/osmium-tool/)
- [DuckDB](https://duckdb.org/)
- [Parquet-Format](https://parquet.apache.org/)
- [Geofabrik OSM-Downloads](https://download.geofabrik.de/)