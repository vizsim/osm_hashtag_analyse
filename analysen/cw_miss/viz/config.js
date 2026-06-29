export const appConfig = {
    title: '#missing-cw_mapillary-signs',
    // Kampagnen (Hashtags) werden im selben Datensatz ueber die Property
    // `campaign` getrennt und im Frontend per Umschalter gefiltert.
    campaigns: [
        { id: 'mapillary-signs',   label: 'Signs',   hashtag: '#missing-cw_mapillary-signs' },
        { id: 'mapillary-feature', label: 'Feature', hashtag: '#missing-cw_mapillary-feature' }
    ],
    defaultCampaign: 'mapillary-signs',
    sankeyDataUrl: './preprocessing/data/sankey.json',
    transitionsIndexUrl: './preprocessing/data/transitions_index.json',
    transitionsPmtilesUrl: './preprocessing/data/transitions.pmtiles',
    mapStyle: 'https://tiles.openfreemap.org/styles/positron',
    fallbackCenter: [10.4, 51.2],
    fallbackZoom: 5.6,
    // Statt einer bounds-Berechnung aus den Geometrien (die mit PMTiles
    // clientseitig nicht mehr verfuegbar sind) verwenden wir feste Bounds.
    // Werte stammen aus den PMTiles-Metadaten (Germany-Datensatz, leicht gepolstert).
    initialBounds: [[5.8, 47.3], [15.1, 55.0]],
    pointViewMaxZoom: 9,
    boundsPadding: 48,
    sourceIds: {
        transitions: 'transitions'
    },
    sourceLayers: {
        lines: 'lines',
        points: 'points'
    },
    layerIds: {
        base: 'transitions-base',
        selectedOutline: 'transitions-selected-outline',
        selected: 'transitions-selected',
        hover: 'transitions-hover',
        pointBase: 'transition-points-base',
        pointSelectedOutline: 'transition-points-selected-outline',
        pointSelected: 'transition-points-selected',
        pointHover: 'transition-points-hover'
    }
};

export const targetColorPalette = [
    '#4d9663',
    '#2f7f72',
    '#2d6b8d',
    '#678d3f',
    '#9d7a2f',
    '#b86a45',
    '#7766a8',
    '#557a95'
];

export const sourceColorPalette = [
    '#2c36a0',
    '#375e97',
    '#4f4fa7',
    '#6c56a8',
    '#8450a1',
    '#9b5f87',
    '#4d6c8d'
];

export const specialCategoryColors = {
    Added: '#843b77'
};

export const mapPaint = {
    baseWidth: [
        'interpolate',
        ['linear'],
        ['zoom'],
        5, 1.2,
        8, 2.2,
        11, 4,
        14, 8
    ],
    highlightWidth: [
        'interpolate',
        ['linear'],
        ['zoom'],
        5, 2.8,
        8, 5,
        11, 8,
        14, 13
    ],
    outlineWidth: [
        'interpolate',
        ['linear'],
        ['zoom'],
        5, 4.6,
        8, 7.5,
        11, 11,
        14, 17
    ],
    hoverWidth: [
        'interpolate',
        ['linear'],
        ['zoom'],
        5, 4,
        8, 7,
        11, 10,
        14, 15
    ],
    pointRadius: [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 2.5,
        6, 4,
        7.99, 6.5
    ],
    pointSelectedRadius: [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 5,
        6, 7.5,
        7.99, 10
    ],
    pointOutlineRadius: [
        'interpolate',
        ['linear'],
        ['zoom'],
        4, 7,
        6, 10,
        7.99, 13
    ]
};