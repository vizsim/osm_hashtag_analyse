#!/usr/bin/env bash
# Erzeugt aus den exportierten GeoJSON-Dateien eine PMTiles mit zwei Layern:
#   - "lines"  : die transitions_strict-Linien fuer hohe Zoom-Stufen
#   - "points" : pro Feature ein Midpoint fuer aggregierte Darstellung bei niedrigem Zoom
#
# Voraussetzung: tippecanoe (>=2.0). Installation siehe https://github.com/felt/tippecanoe
#
# Aufruf:
#   ./generate_pmtiles.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"

LINES_GEOJSON="${DATA_DIR}/transitions_strict.geojson"
POINTS_GEOJSON="${DATA_DIR}/transitions_points.geojson"
OUT_PMTILES="${DATA_DIR}/transitions.pmtiles"

for f in "${LINES_GEOJSON}" "${POINTS_GEOJSON}"; do
    if [[ ! -f "${f}" ]]; then
        echo "Fehlende Eingabedatei: ${f}" >&2
        echo "Bitte zuerst das Preprocessing-Notebook ausfuehren, das die GeoJSONs schreibt." >&2
        exit 1
    fi
done

if ! command -v tippecanoe >/dev/null 2>&1; then
    echo "tippecanoe ist nicht im PATH. Bitte installieren: https://github.com/felt/tippecanoe" >&2
    exit 1
fi

echo "tippecanoe: $(tippecanoe --version 2>&1 | head -n1)"
echo "Input lines : ${LINES_GEOJSON}"
echo "Input points: ${POINTS_GEOJSON}"
echo "Output      : ${OUT_PMTILES}"
echo

tippecanoe \
    --output="${OUT_PMTILES}" \
    --force \
    --read-parallel \
    --no-tile-size-limit \
    --no-feature-limit \
    --drop-rate=1 \
    --minimum-zoom=4 \
    --maximum-zoom=14 \
    --base-zoom=12 \
    --attribution="OSM contributors" \
    --name="cw_miss transitions" \
    -L "lines:${LINES_GEOJSON}" \
    -L "points:${POINTS_GEOJSON}"

echo
echo "Fertig. Groesse:"
ls -lh "${OUT_PMTILES}"
