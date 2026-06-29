import { appConfig, mapPaint, sourceColorPalette, specialCategoryColors, targetColorPalette } from './config.js';
import { addLayerIfMissing, addSourceIfMissing, hasLayer, removeLayerIfExists, removeSourceIfExists } from './map/mapSafeOps.js';
import { renderTimeChart, monthRangeBoundsUtc } from './charts/timeChart.js';

const HOVER_DEBOUNCE_MS = 90;

const mapContainer = document.getElementById('map');
const sankeyContainer = document.getElementById('sankey');
const timelineContainer = document.getElementById('timeline');
const tabSankeyButton = document.getElementById('tab-sankey');
const tabTimelineButton = document.getElementById('tab-timeline');
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
const campaignSwitch = document.getElementById('campaign-switch');
const panelTitle = document.querySelector('.panel-header h1');

const state = {
    map: null,
    campaign: null,
    sankeyRows: [],
    transitionsIndex: [],
    selection: { type: 'none', source: null, target: null },
    hasSeenSelection: false,
    colorMode: 'target',
    activeView: 'sankey',
    colorBySource: {},
    colorByTarget: {},
    sankeyModel: null,
    hoveredFeatureId: null,
    timelineDirty: true,
    transientHighlight: null,
    pendingTransient: undefined,
    transientTimer: null
};

init().catch((error) => {
    console.error(error);
    selectionLabel.textContent = 'Fehler beim Laden';
    selectionMeta.textContent = error instanceof Error ? error.message : String(error);
});

async function init() {
    registerPmtilesProtocol();

    const [sankeyRows, transitionsIndex] = await Promise.all([
        fetchJson(appConfig.sankeyDataUrl),
        fetchJson(appConfig.transitionsIndexUrl)
    ]);

    state.sankeyRows = sankeyRows;
    state.transitionsIndex = transitionsIndex;
    state.campaign = appConfig.defaultCampaign ?? appConfig.campaigns?.[0]?.id ?? null;
    // Farb-Lookups bewusst ueber ALLE Kampagnen und nach Gesamtwert sortiert:
    // (1) bleibt beim Umschalten stabil, (2) reproduziert die alte Single-Campaign-
    // Einfaerbung, da die Farbe sonst von der Zeilenreihenfolge in sankey.json
    // abhinge (die jetzt zuerst nach campaign sortiert ist).
    const rowsByValueDesc = [...sankeyRows].sort(
        (left, right) => Number(right.value ?? 0) - Number(left.value ?? 0)
    );
    state.colorBySource = createCategoryColorLookup(getUniqueValues(rowsByValueDesc, 'source'), sourceColorPalette, specialCategoryColors);
    state.colorByTarget = createCategoryColorLookup(getUniqueValues(rowsByValueDesc, 'target'), targetColorPalette);
    state.sankeyModel = buildSankeyModel(activeSankeyRows());

    buildCampaignSwitch();
    updatePanelTitle();
    updateDataVintage();

    renderSankey();
    initializeMap();
    updateSelection({ type: 'none', source: null, target: null });

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

    tabSankeyButton.addEventListener('click', () => {
        setActiveView('sankey');
    });

    tabTimelineButton.addEventListener('click', () => {
        setActiveView('timeline');
    });
}

function activeSankeyRows() {
    return state.sankeyRows.filter((row) => row.campaign === state.campaign);
}

function activeIndexRows() {
    return state.transitionsIndex.filter((row) => row.campaign === state.campaign);
}

function campaignFilter() {
    return ['==', ['get', 'campaign'], state.campaign];
}

function buildCampaignSwitch() {
    if (!campaignSwitch) return;
    const campaigns = appConfig.campaigns ?? [];
    campaignSwitch.innerHTML = '';
    for (const campaign of campaigns) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'segmented-toggle__button';
        button.dataset.campaign = campaign.id;
        button.textContent = campaign.label ?? campaign.id;
        const isActive = campaign.id === state.campaign;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        button.addEventListener('click', () => setActiveCampaign(campaign.id));
        campaignSwitch.appendChild(button);
    }
}

function syncCampaignButtons() {
    if (!campaignSwitch) return;
    for (const button of campaignSwitch.querySelectorAll('button')) {
        const isActive = button.dataset.campaign === state.campaign;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    }
}

function updatePanelTitle() {
    const campaign = (appConfig.campaigns ?? []).find((item) => item.id === state.campaign);
    const hashtag = campaign?.hashtag ?? appConfig.title ?? '';
    if (panelTitle) panelTitle.textContent = hashtag;
    document.title = `${hashtag} – Sankey + Karte`;
}

function setActiveCampaign(id) {
    if (state.campaign === id) return;
    state.campaign = id;
    syncCampaignButtons();
    updatePanelTitle();

    // Auswahl/Hover zuruecksetzen: Kategorien-Auspraegungen unterscheiden sich je Kampagne.
    clearHoverState();
    state.selection = { type: 'none', source: null, target: null };
    cancelTransientSelection();

    state.sankeyModel = buildSankeyModel(activeSankeyRows());
    renderSankey();

    updateSelectionPanel();
    // Datenstand ist global -> kein Update beim Kampagnenwechsel noetig.

    if (state.map?.isStyleLoaded()) {
        state.map.setFilter(appConfig.layerIds.base, campaignFilter());
        state.map.setFilter(appConfig.layerIds.pointBase, campaignFilter());
        applyMapHighlight();
    }

    state.timelineDirty = true;
    if (state.activeView === 'timeline') {
        ensureTimelineRendered();
    }
}

function registerPmtilesProtocol() {
    if (typeof pmtiles === 'undefined' || typeof maplibregl === 'undefined') return;
    if (registerPmtilesProtocol.done) return;
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    registerPmtilesProtocol.done = true;
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Konnte ${url} nicht laden (${response.status})`);
    }
    return response.json();
}

function updateDataVintage() {
    if (!dataVintage) return;

    // Datenstand = Frische des GESAMTEN Datensatzes (juengste Bearbeitung ueber
    // alle Kampagnen), nicht der aktiven Kampagne -> bleibt beim Umschalten stabil.
    const latestDate = getLatestValidFrom(state.transitionsIndex);
    if (!latestDate) {
        dataVintage.textContent = '';
        return;
    }

    dataVintage.textContent = `Datenstand: ${formatDateOnly(latestDate)}`;
}

function getLatestValidFrom(rows) {
    let latestTimestamp = null;

    for (const row of rows) {
        const rawValue = row?.valid_from;
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

    const sankeyModel = { rows, sources, targets };

    sankeyContainer.on('plotly_click', (event) => {
        const selection = extractSankeySelection(event, sankeyModel);
        if (selection) updateSelection(selection);
    });

    sankeyContainer.on('plotly_hover', (event) => {
        const selection = extractSankeySelection(event, sankeyModel);
        scheduleTransientSelection(selection);
    });

    sankeyContainer.on('plotly_unhover', () => {
        scheduleTransientSelection(null);
    });
}

function extractSankeySelection(event, sankeyModel) {
    const point = event?.points?.[0];
    if (!point) return null;

    const pointIndex = point.pointNumber ?? point.pointIndex ?? point.index;
    if (typeof point.label === 'string' && Number.isInteger(pointIndex)) {
        if (pointIndex < sankeyModel.sources.length) {
            return {
                type: 'source',
                source: sankeyModel.sources[pointIndex],
                target: null
            };
        }

        const targetIndex = pointIndex - sankeyModel.sources.length;
        if (targetIndex >= 0 && targetIndex < sankeyModel.targets.length) {
            return {
                type: 'target',
                source: null,
                target: sankeyModel.targets[targetIndex]
            };
        }
    }

    if (Number.isInteger(pointIndex) && sankeyModel.rows[pointIndex]) {
        const row = sankeyModel.rows[pointIndex];
        return {
            type: 'link',
            source: row.source,
            target: row.target
        };
    }

    return null;
}

function setActiveView(view) {
    if (state.activeView === view) return;
    state.activeView = view;

    const sankeyActive = view === 'sankey';
    tabSankeyButton.classList.toggle('is-active', sankeyActive);
    tabSankeyButton.setAttribute('aria-selected', String(sankeyActive));
    tabTimelineButton.classList.toggle('is-active', !sankeyActive);
    tabTimelineButton.setAttribute('aria-selected', String(!sankeyActive));

    sankeyContainer.classList.toggle('is-hidden', !sankeyActive);
    sankeyContainer.hidden = !sankeyActive;
    timelineContainer.classList.toggle('is-hidden', sankeyActive);
    timelineContainer.hidden = sankeyActive;

    if (!sankeyActive) {
        ensureTimelineRendered();
    } else {
        // Plotly braucht nach Sichtbarkeitswechsel ein resize, sonst bleibt das Sankey
        // ggf. auf der vorigen Containerbreite haengen.
        Plotly.Plots.resize(sankeyContainer);
        // Sichergehen: ein hover-Highlight im Time-Chart darf nicht ueberleben,
        // wenn das Chart unsichtbar wird.
        handleTimelineUnhover();
    }
}

function ensureTimelineRendered() {
    if (!timelineContainer) return;
    renderTimeChart(timelineContainer, activeIndexRows(), {
        colorMode: state.colorMode,
        colorBySource: state.colorBySource,
        colorByTarget: state.colorByTarget,
        formatCategoryLabel,
        onHover: handleTimelineHover,
        onUnhover: handleTimelineUnhover,
        onClick: handleTimelineClick
    });
    state.timelineDirty = false;
}

function selectionFromTimePoint({ monthKey, category, mode }) {
    if (!category || !monthKey) return null;
    if (mode !== 'source' && mode !== 'target') return null;
    return {
        type: mode,
        source: mode === 'source' ? category : null,
        target: mode === 'target' ? category : null,
        month: monthKey
    };
}

function handleTimelineHover(payload) {
    scheduleTransientSelection(selectionFromTimePoint(payload));
}

function handleTimelineUnhover() {
    scheduleTransientSelection(null);
}

function handleTimelineClick(payload) {
    const selection = selectionFromTimePoint(payload);
    if (selection) updateSelection(selection);
}

function scheduleTransientSelection(selection) {
    if (selection) markSelectionSeen();
    state.pendingTransient = selection;
    if (state.transientTimer !== null) return;
    state.transientTimer = setTimeout(() => {
        state.transientTimer = null;
        const next = state.pendingTransient;
        state.pendingTransient = undefined;
        const previous = state.transientHighlight;
        if (!next && !previous) return;
        state.transientHighlight = next ? { selection: next } : null;
        applyMapHighlight();
    }, HOVER_DEBOUNCE_MS);
}

function markSelectionSeen() {
    if (state.hasSeenSelection) return;
    state.hasSeenSelection = true;
    selectionHint?.classList.add('is-hidden');
}

function cancelTransientSelection() {
    if (state.transientTimer !== null) {
        clearTimeout(state.transientTimer);
        state.transientTimer = null;
    }
    state.pendingTransient = undefined;
    state.transientHighlight = null;
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
        if (appConfig.initialBounds) {
            state.map.fitBounds(appConfig.initialBounds, {
                padding: appConfig.boundsPadding,
                duration: 0,
                maxZoom: 12
            });
        }
        attachMapInteractions();
        applyMapHighlight();
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
    removeSourceIfExists(state.map, appConfig.sourceIds.transitions);

    addSourceIfMissing(state.map, appConfig.sourceIds.transitions, {
        type: 'vector',
        url: `pmtiles://${appConfig.transitionsPmtilesUrl}`,
        promoteId: 'feature_id'
    });
}

function addTransitionLayers() {
    addLayerIfMissing(state.map, {
        id: appConfig.layerIds.base,
        type: 'line',
        source: appConfig.sourceIds.transitions,
        'source-layer': appConfig.sourceLayers.lines,
        minzoom: appConfig.pointViewMaxZoom,
        filter: campaignFilter(),
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
        'source-layer': appConfig.sourceLayers.lines,
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
        'source-layer': appConfig.sourceLayers.lines,
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
        'source-layer': appConfig.sourceLayers.lines,
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
        source: appConfig.sourceIds.transitions,
        'source-layer': appConfig.sourceLayers.points,
        maxzoom: appConfig.pointViewMaxZoom,
        filter: campaignFilter(),
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
        source: appConfig.sourceIds.transitions,
        'source-layer': appConfig.sourceLayers.points,
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
        source: appConfig.sourceIds.transitions,
        'source-layer': appConfig.sourceLayers.points,
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
        source: appConfig.sourceIds.transitions,
        'source-layer': appConfig.sourceLayers.points,
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

function updateSelection(nextSelection) {
    if (nextSelection.type !== 'none') markSelectionSeen();

    state.selection = nextSelection;
    cancelTransientSelection();
    updateSelectionPanel();
    if (state.map?.isStyleLoaded()) {
        applyMapHighlight();
    }
}

function applyMapHighlight() {
    if (!state.map?.isStyleLoaded()) return;

    const { filter, hasActive } = computeActiveHighlight();
    const activeColorExpression = buildActiveColorExpression();
    // Selektion laeuft ueber source/target und trifft beide Kampagnen -> auf die
    // aktive Kampagne eingrenzen.
    const selectionFilter = hasActive ? ['all', campaignFilter(), filter] : impossibleFilter();

    state.map.setPaintProperty(appConfig.layerIds.base, 'line-color', activeColorExpression);
    state.map.setPaintProperty(appConfig.layerIds.base, 'line-opacity', hasActive ? 0.14 : 0.72);
    state.map.setPaintProperty(appConfig.layerIds.selected, 'line-color', activeColorExpression);
    state.map.setPaintProperty(appConfig.layerIds.pointBase, 'circle-color', activeColorExpression);
    state.map.setPaintProperty(appConfig.layerIds.pointBase, 'circle-opacity', hasActive ? 0.2 : 0.8);
    state.map.setPaintProperty(appConfig.layerIds.pointSelected, 'circle-color', activeColorExpression);
    state.map.setFilter(appConfig.layerIds.selectedOutline, selectionFilter);
    state.map.setFilter(appConfig.layerIds.selected, selectionFilter);
    state.map.setFilter(appConfig.layerIds.pointSelectedOutline, selectionFilter);
    state.map.setFilter(appConfig.layerIds.pointSelected, selectionFilter);
}

function computeActiveHighlight() {
    // Transientes Hover-Highlight (Sankey- oder Time-Chart-Hover) hat Vorrang
    // vor der dauerhaften Klick-Selection.
    if (state.transientHighlight?.selection) {
        return {
            filter: buildSelectionFilter(state.transientHighlight.selection),
            hasActive: true
        };
    }
    if (state.selection.type !== 'none') {
        return { filter: buildSelectionFilter(state.selection), hasActive: true };
    }
    return { filter: impossibleFilter(), hasActive: false };
}

function updateColorMode(nextMode) {
    if (state.colorMode === nextMode) return;
    state.colorMode = nextMode;
    syncColorModeButtons();
    if (state.map?.isStyleLoaded()) {
        applyMapHighlight();
    }
    state.timelineDirty = true;
    if (state.activeView === 'timeline') {
        ensureTimelineRendered();
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
    const selectedRows = getSelectedIndexRows();
    const totalLength = selectedRows.reduce((sum, row) => sum + Number(row.length_km ?? 0), 0);

    if (state.selection.type === 'none') {
        selectionLabel.textContent = 'Keine';
        selectionMeta.textContent = `${activeIndexRows().length} Geometrien, gesamte Datenbasis`;
        return;
    }

    selectionLabel.textContent = formatSelectionLabel(state.selection);
    selectionMeta.textContent = `${selectedRows.length} Geometrien, ${formatKilometers(totalLength)}`;
}

function getSelectedIndexRows() {
    const selection = state.selection;
    const bounds = selection.month ? monthRangeBoundsUtc(selection.month) : null;
    const matchesMonth = (row) => {
        if (!bounds) return true;
        const value = row?.valid_from;
        if (typeof value !== 'string') return false;
        return value >= bounds.start && value < bounds.end;
    };

    const rows = activeIndexRows();
    switch (selection.type) {
        case 'source':
            return rows.filter((row) => row.source === selection.source && matchesMonth(row));
        case 'target':
            return rows.filter((row) => row.target === selection.target && matchesMonth(row));
        case 'link':
            return rows.filter((row) => (
                row.source === selection.source
                && row.target === selection.target
                && matchesMonth(row)
            ));
        default:
            return rows;
    }
}

function formatSelectionLabel(selection) {
    const base = formatSelectionBaseLabel(selection);
    if (!selection.month) return base;
    return `${base} · ${formatMonthLabelDe(selection.month)}`;
}

function formatSelectionBaseLabel(selection) {
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

function formatMonthLabelDe(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthKey ?? '');
    if (!match) return String(monthKey ?? '');
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    return date.toLocaleDateString('de-DE', { year: 'numeric', month: 'short' });
}

function buildSelectionFilter(selection) {
    const base = buildSelectionBaseFilter(selection);
    if (!selection.month) return base;
    const bounds = monthRangeBoundsUtc(selection.month);
    if (!bounds) return base;
    return ['all',
        base,
        ['>=', ['get', 'valid_from'], bounds.start],
        ['<', ['get', 'valid_from'], bounds.end]
    ];
}

function buildSelectionBaseFilter(selection) {
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
