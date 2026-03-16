import { appConfig, mapPaint, sourceColorPalette, specialCategoryColors, targetColorPalette } from './config.js';
import { addLayerIfMissing, addSourceIfMissing, hasLayer, removeLayerIfExists, removeSourceIfExists } from './map/mapSafeOps.js';

const mapContainer = document.getElementById('map');
const sankeyContainer = document.getElementById('sankey');
const selectionLabel = document.getElementById('selection-label');
const selectionMeta = document.getElementById('selection-meta');
const selectionHint = document.getElementById('selection-hint');
const resetButton = document.getElementById('reset-selection');
const hoverCard = document.getElementById('hover-card');
const hoverTitle = document.getElementById('hover-title');
const hoverCopy = document.getElementById('hover-copy');
const colorModeTargetButton = document.getElementById('color-mode-target');
const colorModeSourceButton = document.getElementById('color-mode-source');
const dataVintage = document.getElementById('data-vintage');

const state = {
    map: null,
    sankeyRows: [],
    transitionsGeojson: null,
    transitionPointsGeojson: null,
    selection: { type: 'none', source: null, target: null },
    hasSeenSelection: false,
    colorMode: 'target',
    colorBySource: {},
    colorByTarget: {},
    sankeyModel: null,
    hoveredFeatureId: null
};

init().catch((error) => {
    console.error(error);
    selectionLabel.textContent = 'Fehler beim Laden';
    selectionMeta.textContent = error instanceof Error ? error.message : String(error);
});

async function init() {
    const [sankeyRows, transitionsGeojson] = await Promise.all([
        fetchJson(appConfig.sankeyDataUrl),
        fetchJson(appConfig.transitionsDataUrl)
    ]);

    state.sankeyRows = sankeyRows;
    state.transitionsGeojson = normalizeTransitionsGeojson(transitionsGeojson);
    state.transitionPointsGeojson = buildTransitionPointGeojson(state.transitionsGeojson);
    state.colorBySource = createCategoryColorLookup(getUniqueValues(sankeyRows, 'source'), sourceColorPalette, specialCategoryColors);
    state.colorByTarget = createCategoryColorLookup(getUniqueValues(sankeyRows, 'target'), targetColorPalette);
    state.sankeyModel = buildSankeyModel(sankeyRows);

    updateDataVintage();

    renderSankey();
    initializeMap();
    updateSelection({ type: 'none', source: null, target: null }, { fitSelection: false });

    resetButton.addEventListener('click', () => {
        clearHoverState();
        updateSelection({ type: 'none', source: null, target: null });
    });

    colorModeTargetButton.addEventListener('click', () => {
        updateColorMode('target');
    });

    colorModeSourceButton.addEventListener('click', () => {
        updateColorMode('source');
    });
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Konnte ${url} nicht laden (${response.status})`);
    }
    return response.json();
}

function normalizeTransitionsGeojson(geojson) {
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    for (const feature of features) {
        const props = feature.properties ?? {};
        if (!props.feature_id) {
            props.feature_id = `${props.osm_id ?? 'unknown'}_${props.osm_version ?? '0'}`;
        }
        if (typeof props.length_km !== 'number') {
            props.length_km = Number(props.length_km ?? 0);
        }
        feature.properties = props;
    }
    return { ...geojson, features };
}

function buildTransitionPointGeojson(geojson) {
    const pointFeatures = geojson.features
        .map((feature) => createPointFeature(feature))
        .filter(Boolean);

    return {
        type: 'FeatureCollection',
        features: pointFeatures
    };
}

function createPointFeature(feature) {
    const coordinate = getRepresentativeCoordinate(feature.geometry);
    if (!coordinate) return null;

    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: coordinate
        },
        properties: { ...(feature.properties ?? {}) }
    };
}

function getRepresentativeCoordinate(geometry) {
    if (!geometry) return null;

    if (geometry.type === 'LineString') {
        return getLineMidpoint(geometry.coordinates);
    }

    if (geometry.type === 'MultiLineString') {
        const longestLine = geometry.coordinates.reduce((longest, current) => {
            return getCoordinatePathLength(current) > getCoordinatePathLength(longest) ? current : longest;
        }, geometry.coordinates[0] ?? []);
        return longestLine.length ? getLineMidpoint(longestLine) : null;
    }

    if (geometry.type === 'Point') {
        return geometry.coordinates;
    }

    if (geometry.type === 'MultiPoint') {
        return geometry.coordinates[0] ?? null;
    }

    return null;
}

function getLineMidpoint(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
    if (coordinates.length === 1) return coordinates[0];

    const totalLength = getCoordinatePathLength(coordinates);
    if (totalLength === 0) {
        return coordinates[Math.floor(coordinates.length / 2)];
    }

    const halfLength = totalLength / 2;
    let traversed = 0;

    for (let index = 1; index < coordinates.length; index += 1) {
        const start = coordinates[index - 1];
        const end = coordinates[index];
        const segmentLength = getSegmentLength(start, end);
        if (traversed + segmentLength >= halfLength) {
            const remaining = halfLength - traversed;
            const ratio = segmentLength === 0 ? 0 : remaining / segmentLength;
            return [
                start[0] + (end[0] - start[0]) * ratio,
                start[1] + (end[1] - start[1]) * ratio
            ];
        }
        traversed += segmentLength;
    }

    return coordinates[coordinates.length - 1];
}

function getCoordinatePathLength(coordinates) {
    let length = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
        length += getSegmentLength(coordinates[index - 1], coordinates[index]);
    }
    return length;
}

function getSegmentLength(start, end) {
    const deltaX = Number(end?.[0] ?? 0) - Number(start?.[0] ?? 0);
    const deltaY = Number(end?.[1] ?? 0) - Number(start?.[1] ?? 0);
    return Math.hypot(deltaX, deltaY);
}

function updateDataVintage() {
    if (!dataVintage) return;

    const latestDate = getLatestValidFrom(state.transitionsGeojson?.features ?? []);
    if (!latestDate) {
        dataVintage.textContent = '';
        return;
    }

    dataVintage.textContent = `Datenstand: ${formatDateOnly(latestDate)}`;
}

function getLatestValidFrom(features) {
    let latestTimestamp = null;

    for (const feature of features) {
        const rawValue = feature?.properties?.valid_from;
        if (!rawValue) continue;

        const date = new Date(rawValue);
        const timestamp = date.getTime();
        if (Number.isNaN(timestamp)) continue;

        if (latestTimestamp === null || timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
        }
    }

    return latestTimestamp === null ? null : new Date(latestTimestamp);
}

function getUniqueValues(rows, key) {
    return [...new Set(rows.map((row) => row[key]))];
}

function createCategoryColorLookup(categories, palette, seedColors = {}) {
    const lookup = { ...seedColors };
    let paletteIndex = 0;

    for (const category of categories) {
        if (lookup[category]) continue;
        lookup[category] = palette[paletteIndex % palette.length];
        paletteIndex += 1;
    }

    return lookup;
}

function buildSankeyModel(rows) {
    const sourceTotals = groupTotals(rows, 'source');
    const targetTotals = groupTotals(rows, 'target');
    const sources = [...sourceTotals.keys()].sort((left, right) => sourceTotals.get(right) - sourceTotals.get(left));
    const targets = [...targetTotals.keys()].sort((left, right) => targetTotals.get(right) - targetTotals.get(left));
    return { rows, sources, targets };
}

function groupTotals(rows, key) {
    const totals = new Map();
    for (const row of rows) {
        totals.set(row[key], (totals.get(row[key]) ?? 0) + Number(row.value ?? 0));
    }
    return totals;
}

function renderSankey() {
    const { rows, sources, targets } = state.sankeyModel;
    const sourceTotals = groupTotals(rows, 'source');
    const targetTotals = groupTotals(rows, 'target');
    const nodeLabels = [
        ...sources.map((source) => formatCategoryLabel(source)),
        ...targets.map((target) => formatCategoryLabel(target))
    ];

    const nodeCustomData = [
        ...sources.map((source) => Number(sourceTotals.get(source) ?? 0)),
        ...targets.map((target) => Number(targetTotals.get(target) ?? 0))
    ];

    const nodeColors = [
        ...sources.map((source) => state.colorBySource[source] ?? '#54606c'),
        ...targets.map((target) => state.colorByTarget[target] ?? '#54606c')
    ];

    const sourceIndexMap = Object.fromEntries(sources.map((source, index) => [source, index]));
    const targetIndexMap = Object.fromEntries(targets.map((target, index) => [target, sources.length + index]));

    const linkSources = [];
    const linkTargets = [];
    const linkValues = [];
    const linkColors = [];

    for (const row of rows) {
        linkSources.push(sourceIndexMap[row.source]);
        linkTargets.push(targetIndexMap[row.target]);
        linkValues.push(row.value);
        linkColors.push(withAlpha(state.colorByTarget[row.target] ?? '#7c8b95', row.source === 'Added' ? 0.55 : 0.38));
    }

    const trace = {
        type: 'sankey',
        arrangement: 'fixed',
        node: {
            pad: 22,
            thickness: 18,
            line: { color: 'rgba(23, 23, 23, 0.14)', width: 1 },
            label: nodeLabels,
            customdata: nodeCustomData,
            hovertemplate: '<b>%{label}</b><br>%{customdata:.1f} km<extra></extra>',
            color: nodeColors,
            x: [
                ...sources.map(() => 0.02),
                ...targets.map(() => 0.98)
            ]
        },
        link: {
            source: linkSources,
            target: linkTargets,
            value: linkValues,
            color: linkColors,
            hovertemplate: '<b>%{source.label}</b> → <b>%{target.label}</b><br>%{value:.1f} km<extra></extra>'
        }
    };

    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 18, r: 18, t: 14, b: 14 },
        font: {
            family: 'Avenir Next, Segoe UI, sans-serif',
            size: 12,
            color: '#201913'
        }
    };

    Plotly.newPlot(sankeyContainer, [trace], layout, {
        displayModeBar: false,
        responsive: true,
        scrollZoom: false
    });

    sankeyContainer.on('plotly_click', (event) => {
        handleSankeyClick(event, { rows, sources, targets });
    });
}

function handleSankeyClick(event, sankeyModel) {
    const point = event?.points?.[0];
    if (!point) return;

    const pointIndex = point.pointNumber ?? point.pointIndex ?? point.index;
    if (typeof point.label === 'string' && Number.isInteger(pointIndex)) {
        if (pointIndex < sankeyModel.sources.length) {
            updateSelection({
                type: 'source',
                source: sankeyModel.sources[pointIndex],
                target: null
            });
            return;
        }

        const targetIndex = pointIndex - sankeyModel.sources.length;
        if (targetIndex >= 0 && targetIndex < sankeyModel.targets.length) {
            updateSelection({
                type: 'target',
                source: null,
                target: sankeyModel.targets[targetIndex]
            });
            return;
        }
    }

    if (Number.isInteger(pointIndex) && sankeyModel.rows[pointIndex]) {
        const row = sankeyModel.rows[pointIndex];
        updateSelection({
            type: 'link',
            source: row.source,
            target: row.target
        });
    }
}

function initializeMap() {
    state.map = new maplibregl.Map({
        container: mapContainer,
        style: appConfig.mapStyle,
        center: appConfig.fallbackCenter,
        zoom: appConfig.fallbackZoom,
        attributionControl: true
    });

    state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    state.map.on('load', () => {
        rebuildTransitionSource();
        addTransitionLayers();
        fitMapToFeatures(state.transitionsGeojson.features);
        attachMapInteractions();
        applySelectionToMap();
    });
}

function rebuildTransitionSource() {
    removeLayerIfExists(state.map, appConfig.layerIds.pointHover);
    removeLayerIfExists(state.map, appConfig.layerIds.pointSelected);
    removeLayerIfExists(state.map, appConfig.layerIds.pointSelectedOutline);
    removeLayerIfExists(state.map, appConfig.layerIds.pointBase);
    removeLayerIfExists(state.map, appConfig.layerIds.hover);
    removeLayerIfExists(state.map, appConfig.layerIds.selected);
    removeLayerIfExists(state.map, appConfig.layerIds.selectedOutline);
    removeLayerIfExists(state.map, appConfig.layerIds.base);
    removeSourceIfExists(state.map, appConfig.sourceIds.transitionPoints);
    removeSourceIfExists(state.map, appConfig.sourceIds.transitions);

    addSourceIfMissing(state.map, appConfig.sourceIds.transitions, {
        type: 'geojson',
        data: state.transitionsGeojson
    });

    addSourceIfMissing(state.map, appConfig.sourceIds.transitionPoints, {
        type: 'geojson',
        data: state.transitionPointsGeojson
    });
}

function addTransitionLayers() {
    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.base,
        type: 'line',
        source: appConfig.sourceIds.transitions,
        minzoom: appConfig.pointViewMaxZoom,
        paint: {
            'line-color': buildActiveColorExpression(),
            'line-width': mapPaint.baseWidth,
            'line-opacity': 0.72
        }
    });

    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.selectedOutline,
        type: 'line',
        source: appConfig.sourceIds.transitions,
        minzoom: appConfig.pointViewMaxZoom,
        filter: impossibleFilter(),
        paint: {
            'line-color': '#fff7ec',
            'line-width': mapPaint.outlineWidth,
            'line-opacity': 0.92
        }
    });

    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.selected,
        type: 'line',
        source: appConfig.sourceIds.transitions,
        minzoom: appConfig.pointViewMaxZoom,
        filter: impossibleFilter(),
        paint: {
            'line-color': buildActiveColorExpression(),
            'line-width': mapPaint.highlightWidth,
            'line-opacity': 0.96
        }
    });

    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.hover,
        type: 'line',
        source: appConfig.sourceIds.transitions,
        minzoom: appConfig.pointViewMaxZoom,
        filter: impossibleFilter(),
        paint: {
            'line-color': '#111827',
            'line-width': mapPaint.hoverWidth,
            'line-opacity': 0.96
        }
    });

    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.pointBase,
        type: 'circle',
        source: appConfig.sourceIds.transitionPoints,
        maxzoom: appConfig.pointViewMaxZoom,
        paint: {
            'circle-color': buildActiveColorExpression(),
            'circle-radius': mapPaint.pointRadius,
            'circle-opacity': 0.8,
            'circle-stroke-width': 0,
            'circle-pitch-alignment': 'map'
        }
    });

    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.pointSelectedOutline,
        type: 'circle',
        source: appConfig.sourceIds.transitionPoints,
        maxzoom: appConfig.pointViewMaxZoom,
        filter: impossibleFilter(),
        paint: {
            'circle-color': '#fff7ec',
            'circle-radius': mapPaint.pointOutlineRadius,
            'circle-opacity': 0.95
        }
    });

    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.pointSelected,
        type: 'circle',
        source: appConfig.sourceIds.transitionPoints,
        maxzoom: appConfig.pointViewMaxZoom,
        filter: impossibleFilter(),
        paint: {
            'circle-color': buildActiveColorExpression(),
            'circle-radius': mapPaint.pointSelectedRadius,
            'circle-opacity': 0.95
        }
    });

    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.pointHover,
        type: 'circle',
        source: appConfig.sourceIds.transitionPoints,
        maxzoom: appConfig.pointViewMaxZoom,
        filter: impossibleFilter(),
        paint: {
            'circle-color': '#111827',
            'circle-radius': mapPaint.pointOutlineRadius,
            'circle-opacity': 0.95
        }
    });
}

function attachMapInteractions() {
    const interactiveLayerIds = [
        appConfig.layerIds.selected,
        appConfig.layerIds.base,
        appConfig.layerIds.pointSelected,
        appConfig.layerIds.pointBase
    ];

    state.map.on('mousemove', (event) => {
        const features = state.map.queryRenderedFeatures(event.point, { layers: interactiveLayerIds });
        const feature = features[0];

        if (!feature) {
            clearHoverState();
            return;
        }

        state.map.getCanvas().style.cursor = 'pointer';
        const props = feature.properties ?? {};
        const featureId = props.feature_id;
        if (featureId && featureId !== state.hoveredFeatureId) {
            state.hoveredFeatureId = featureId;
            state.map.setFilter(appConfig.layerIds.hover, ['==', ['get', 'feature_id'], featureId]);
            state.map.setFilter(appConfig.layerIds.pointHover, ['==', ['get', 'feature_id'], featureId]);
        }

        showHoverCard(props);
    });

    state.map.on('click', (event) => {
        const features = state.map.queryRenderedFeatures(event.point, { layers: interactiveLayerIds });
        const feature = features[0];
        const osmId = feature?.properties?.osm_id;
        if (!osmId) return;

        const osmUrl = `https://www.openstreetmap.org/way/${encodeURIComponent(String(osmId))}`;
        window.open(osmUrl, '_blank', 'noopener,noreferrer');
    });

    state.map.on('mouseleave', appConfig.layerIds.base, clearHoverState);
    state.map.on('mouseleave', appConfig.layerIds.selected, clearHoverState);
    state.map.on('mouseleave', appConfig.layerIds.pointBase, clearHoverState);
    state.map.on('mouseleave', appConfig.layerIds.pointSelected, clearHoverState);
}

function clearHoverState() {
    if (!state.map) return;

    state.hoveredFeatureId = null;
    state.map.getCanvas().style.cursor = '';
    if (hasLayer(state.map, appConfig.layerIds.hover)) {
        state.map.setFilter(appConfig.layerIds.hover, impossibleFilter());
    }
    if (hasLayer(state.map, appConfig.layerIds.pointHover)) {
        state.map.setFilter(appConfig.layerIds.pointHover, impossibleFilter());
    }
    hideHoverCard();
}

function updateSelection(nextSelection, options = {}) {
    if (!state.hasSeenSelection && nextSelection.type !== 'none') {
        state.hasSeenSelection = true;
        selectionHint?.classList.add('is-hidden');
    }

    state.selection = nextSelection;
    updateSelectionPanel();
    if (state.map?.isStyleLoaded()) {
        applySelectionToMap();
        if (options.fitSelection === true) {
            fitMapToFeatures(getSelectedFeatures());
        }
    }
}

function applySelectionToMap() {
    if (!state.map?.isStyleLoaded()) return;

    const hasActiveSelection = state.selection.type !== 'none';
    const filter = buildSelectionFilter(state.selection);
    const activeColorExpression = buildActiveColorExpression();

    state.map.setPaintProperty(appConfig.layerIds.base, 'line-color', activeColorExpression);
    state.map.setPaintProperty(appConfig.layerIds.base, 'line-opacity', hasActiveSelection ? 0.14 : 0.72);
    state.map.setPaintProperty(appConfig.layerIds.selected, 'line-color', activeColorExpression);
    state.map.setPaintProperty(appConfig.layerIds.pointBase, 'circle-color', activeColorExpression);
    state.map.setPaintProperty(appConfig.layerIds.pointBase, 'circle-opacity', hasActiveSelection ? 0.2 : 0.8);
    state.map.setPaintProperty(appConfig.layerIds.pointSelected, 'circle-color', activeColorExpression);
    state.map.setFilter(appConfig.layerIds.selectedOutline, hasActiveSelection ? filter : impossibleFilter());
    state.map.setFilter(appConfig.layerIds.selected, hasActiveSelection ? filter : impossibleFilter());
    state.map.setFilter(appConfig.layerIds.pointSelectedOutline, hasActiveSelection ? filter : impossibleFilter());
    state.map.setFilter(appConfig.layerIds.pointSelected, hasActiveSelection ? filter : impossibleFilter());
}

function updateColorMode(nextMode) {
    if (state.colorMode === nextMode) return;
    state.colorMode = nextMode;
    syncColorModeButtons();
    if (state.map?.isStyleLoaded()) {
        applySelectionToMap();
    }
}

function syncColorModeButtons() {
    const targetActive = state.colorMode === 'target';
    colorModeTargetButton.classList.toggle('is-active', targetActive);
    colorModeTargetButton.setAttribute('aria-pressed', String(targetActive));
    colorModeSourceButton.classList.toggle('is-active', !targetActive);
    colorModeSourceButton.setAttribute('aria-pressed', String(!targetActive));
}

function updateSelectionPanel() {
    const selectedFeatures = getSelectedFeatures();
    const totalLength = selectedFeatures.reduce((sum, feature) => sum + Number(feature.properties?.length_km ?? 0), 0);

    if (state.selection.type === 'none') {
        selectionLabel.textContent = 'Keine';
        selectionMeta.textContent = `${state.transitionsGeojson.features.length} Geometrien, gesamte Datenbasis`;
        return;
    }

    selectionLabel.textContent = formatSelectionLabel(state.selection);
    selectionMeta.textContent = `${selectedFeatures.length} Geometrien, ${formatKilometers(totalLength)}`;
}

function getSelectedFeatures() {
    const features = state.transitionsGeojson.features;
    switch (state.selection.type) {
        case 'source':
            return features.filter((feature) => feature.properties?.source === state.selection.source);
        case 'target':
            return features.filter((feature) => feature.properties?.target === state.selection.target);
        case 'link':
            return features.filter((feature) => (
                feature.properties?.source === state.selection.source
                && feature.properties?.target === state.selection.target
            ));
        default:
            return features;
    }
}

function formatSelectionLabel(selection) {
    if (selection.type === 'source') {
        return `Source: ${formatCategoryLabel(selection.source)}`;
    }
    if (selection.type === 'target') {
        return `Target: ${formatCategoryLabel(selection.target)}`;
    }
    if (selection.type === 'link') {
        return `${formatCategoryLabel(selection.source)} → ${formatCategoryLabel(selection.target)}`;
    }
    return 'Keine';
}

function buildSelectionFilter(selection) {
    if (selection.type === 'source') {
        return ['==', ['get', 'source'], selection.source];
    }
    if (selection.type === 'target') {
        return ['==', ['get', 'target'], selection.target];
    }
    if (selection.type === 'link') {
        return ['all',
            ['==', ['get', 'source'], selection.source],
            ['==', ['get', 'target'], selection.target]
        ];
    }
    return impossibleFilter();
}

function impossibleFilter() {
    return ['==', ['get', 'feature_id'], '__none__'];
}

function buildActiveColorExpression() {
    if (state.colorMode === 'source') {
        return buildSourceColorExpression();
    }
    return buildTargetColorExpression();
}

function buildTargetColorExpression() {
    return buildCategoryColorExpression('target', state.colorByTarget);
}

function buildSourceColorExpression() {
    return buildCategoryColorExpression('source', state.colorBySource);
}

function buildCategoryColorExpression(propertyName, lookup) {
    const expression = ['match', ['get', propertyName]];
    for (const [category, color] of Object.entries(lookup)) {
        expression.push(category, color);
    }
    expression.push('#b9bfbc');
    return expression;
}

function fitMapToFeatures(features) {
    const bounds = calculateBounds(features);
    if (!bounds) return;
    state.map.fitBounds(bounds, {
        padding: appConfig.boundsPadding,
        duration: 800,
        maxZoom: features.length === 1 ? 14 : 12
    });
}

function calculateBounds(features) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    for (const feature of features) {
        visitCoordinates(feature.geometry, ([lng, lat]) => {
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
            minLng = Math.min(minLng, lng);
            minLat = Math.min(minLat, lat);
            maxLng = Math.max(maxLng, lng);
            maxLat = Math.max(maxLat, lat);
        });
    }

    if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
        return null;
    }

    return [[minLng, minLat], [maxLng, maxLat]];
}

function visitCoordinates(geometry, visitor) {
    if (!geometry) return;

    if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
        geometry.coordinates.forEach(visitor);
        return;
    }

    if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
        geometry.coordinates.forEach((part) => part.forEach(visitor));
        return;
    }

    if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((polygon) => {
            polygon.forEach((ring) => ring.forEach(visitor));
        });
    }
}

function showHoverCard(properties) {
    hoverTitle.innerHTML = `${escapeHtml(formatCategoryLabel(properties.source))} →<br>${escapeHtml(formatCategoryLabel(properties.target))}`;
    hoverCopy.innerHTML = `
        <dl class="hover-detail-grid">
            <dt>Länge</dt>
            <dd>${escapeHtml(formatMetersFromKilometers(properties.length_km))}</dd>
            <dt>OSM ID</dt>
            <dd>${escapeHtml(String(properties.osm_id ?? ''))}</dd>
            <dt>Version</dt>
            <dd>${escapeHtml(String(properties.osm_version ?? ''))}</dd>
            <dt>valid_from</dt>
            <dd>${escapeHtml(formatDate(properties.valid_from))}</dd>
        </dl>
    `;
    hoverCard.classList.remove('is-hidden');
}

function hideHoverCard() {
    hoverCopy.innerHTML = '';
    hoverCard.classList.add('is-hidden');
}

function formatCategoryLabel(value) {
    return String(value ?? '')
        .replace(/_other$/g, ' (other)')
        .replace('hw=', 'hw=')
        .replace(/_bicycle=designated/g, ' | bicycle=designated')
        .replace(/_bicycle=yes/g, ' | bicycle=yes')
        .replace(/_/g, ' ');
}

function formatKilometers(value) {
    const number = Number(value ?? 0);
    return `${number.toLocaleString('de-DE', {
        minimumFractionDigits: number >= 10 ? 0 : 1,
        maximumFractionDigits: 1
    })} km`;
}

function formatMetersFromKilometers(value) {
    const meters = Number(value ?? 0) * 1000;
    return `${meters.toLocaleString('de-DE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: meters < 10 ? 1 : 0
    })} m`;
}

function formatDate(value) {
    if (!value) return 'unbekannt';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateOnly(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'unbekannt';
    return date.toLocaleDateString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function withAlpha(hexColor, alpha) {
    const normalized = hexColor.replace('#', '');
    const bigint = Number.parseInt(normalized, 16);
    const red = (bigint >> 16) & 255;
    const green = (bigint >> 8) & 255;
    const blue = bigint & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}