export function hasLayer(map, layerId) {
    return Boolean(map && map.getLayer(layerId));
}

export function hasSource(map, sourceId) {
    return Boolean(map && map.getSource(sourceId));
}

export function removeLayerIfExists(map, layerId) {
    if (!hasLayer(map, layerId)) return;
    map.removeLayer(layerId);
}

export function removeSourceIfExists(map, sourceId) {
    if (!hasSource(map, sourceId)) return;
    map.removeSource(sourceId);
}

export function addSourceIfMissing(map, sourceId, sourceConfig) {
    if (!map || hasSource(map, sourceId)) return;
    map.addSource(sourceId, sourceConfig);
}

export function addLayerIfMissing(map, layerConfigEntry) {
    if (!map || hasLayer(map, layerConfigEntry.id)) return;
    map.addLayer(layerConfigEntry);
}