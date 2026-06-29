// Stacked Bar Chart: km neu erfasster Radinfrastruktur je Monat,
// gestapelt nach source bzw. target abhaengig vom colorMode.

const MONTH_FORMAT_DE = new Intl.DateTimeFormat('de-DE', {
    year: 'numeric',
    month: 'short'
});

export function renderTimeChart(container, indexRows, options) {
    if (!container) return;

    const colorMode = options.colorMode === 'source' ? 'source' : 'target';
    const colorLookup = colorMode === 'source' ? options.colorBySource : options.colorByTarget;
    const formatLabel = options.formatCategoryLabel ?? ((value) => String(value));

    const { months: dataMonths, categories, totalsByCategory, valuesByCategoryByMonth } = aggregate(indexRows, colorMode);

    if (dataMonths.length === 0 || categories.length === 0) {
        container.innerHTML = '<div class="timeline-empty">Keine Daten verfuegbar.</div>';
        return;
    }

    // Lueckenlose Monatsachse vom ersten bis zum letzten Datenmonat: Monate ohne
    // Beitraege erscheinen als leere (0-)Balken statt einfach zu verschwinden.
    const months = enumerateMonths(dataMonths[0], dataMonths[dataMonths.length - 1]);

    // y-Maximum mode-unabhaengig fixieren, damit die Skala beim
    // Source/Target-Toggle stabil bleibt. Pro Zeile traegt length_km zu genau
    // einem Monat bei, unabhaengig von der Gruppierung -> Monatssumme ist
    // identisch in beiden Modi. dtick wird explizit gesetzt, weil Plotlys
    // Auto-Tick sonst je nach Legendenhoehe unterschiedliche Schrittweiten
    // waehlt.
    const yMax = computeStableYMax(indexRows);
    const yDtick = pickDtick(yMax);

    const monthLabels = months.map((monthKey) => formatMonthLabel(monthKey));

    // Kategorien stabil sortieren: groesste Summe zuerst, damit die wichtigsten
    // Slices unten liegen.
    const sortedCategories = [...categories].sort(
        (a, b) => (totalsByCategory.get(b) ?? 0) - (totalsByCategory.get(a) ?? 0)
    );

    const traces = sortedCategories.map((category) => {
        const values = months.map((monthKey) => {
            const value = valuesByCategoryByMonth.get(category)?.get(monthKey) ?? 0;
            return Number(value.toFixed(2));
        });
        return {
            type: 'bar',
            name: formatLabel(category),
            x: monthLabels,
            y: values,
            customdata: months,
            meta: { category, mode: colorMode },
            marker: { color: colorLookup[category] ?? '#8a9099' },
            hovertemplate: '<b>%{x}</b><br>%{fullData.name}: %{y:.1f} km<extra></extra>'
        };
    });

    const layout = {
        barmode: 'stack',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 56, r: 14, t: 14, b: 60 },
        font: {
            family: 'Avenir Next, Segoe UI, sans-serif',
            size: 12,
            color: '#201913'
        },
        showlegend: false,
        xaxis: {
            title: { text: '' },
            tickangle: -45,
            automargin: true
        },
        yaxis: {
            title: { text: 'km neu erfasster Radinfrastruktur', standoff: 12 },
            ticksuffix: ' km',
            range: [0, yMax],
            autorange: false,
            tick0: 0,
            dtick: yDtick,
            gridcolor: 'rgba(53, 45, 35, 0.08)',
            zerolinecolor: 'rgba(53, 45, 35, 0.18)'
        },
        hoverlabel: {
            bgcolor: '#fffaf2',
            bordercolor: 'rgba(53, 45, 35, 0.18)',
            font: { color: '#201913' }
        }
    };

    Plotly.react(container, traces, layout, {
        displayModeBar: false,
        responsive: true,
        scrollZoom: false
    });

    // Plotly's on() haengt jeden Aufruf addieren, daher vorher removeAllListeners.
    if (typeof container.removeAllListeners === 'function') {
        container.removeAllListeners('plotly_hover');
        container.removeAllListeners('plotly_unhover');
        container.removeAllListeners('plotly_click');
    }

    const extractPointPayload = (event) => {
        const point = event?.points?.[0];
        if (!point) return null;
        const meta = point.data?.meta;
        const monthKey = typeof point.customdata === 'string' ? point.customdata : null;
        if (!meta || !monthKey) return null;
        return { monthKey, category: meta.category, mode: meta.mode };
    };

    if (typeof options.onHover === 'function') {
        container.on('plotly_hover', (event) => {
            const payload = extractPointPayload(event);
            if (payload) options.onHover(payload);
        });
    }

    if (typeof options.onUnhover === 'function') {
        container.on('plotly_unhover', () => {
            options.onUnhover();
        });
    }

    if (typeof options.onClick === 'function') {
        container.on('plotly_click', (event) => {
            const payload = extractPointPayload(event);
            if (payload) options.onClick(payload);
        });
    }
}

// Liefert den exklusiven oberen Monatsrand zu einem YYYY-MM-Key, fuer Filter
// auf valid_from im Format "YYYY-MM-DDTHH:MM:SSZ".
export function monthRangeBoundsUtc(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthKey ?? '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return {
        start: start.toISOString().replace(/\.\d+Z$/, 'Z'),
        end: end.toISOString().replace(/\.\d+Z$/, 'Z')
    };
}

// Liefert alle YYYY-MM-Keys von startKey bis endKey (inklusive), lueckenlos.
function enumerateMonths(startKey, endKey) {
    const parse = (key) => {
        const [year, month] = String(key).split('-').map(Number);
        return { year, month };
    };
    const start = parse(startKey);
    const end = parse(endKey);
    if (!start.year || !start.month || !end.year || !end.month) {
        return startKey === endKey ? [startKey] : [startKey, endKey];
    }

    const months = [];
    let year = start.year;
    let month = start.month;
    while (year < end.year || (year === end.year && month <= end.month)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }
    return months;
}

function computeStableYMax(rows) {
    const monthTotals = new Map();
    for (const row of rows) {
        const monthKey = monthKeyFromValidFrom(row.valid_from);
        if (!monthKey) continue;
        const lengthKm = Number(row.length_km ?? 0);
        if (!Number.isFinite(lengthKm) || lengthKm <= 0) continue;
        monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + lengthKm);
    }
    const max = monthTotals.size ? Math.max(...monthTotals.values()) : 0;
    return max > 0 ? max * 1.05 : 1;
}

function pickDtick(yMax) {
    // Reine 1-2-5-Schritte, Ziel ca. 6-8 sichtbare Ticks.
    const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const target = yMax / 7;
    for (const step of niceSteps) {
        if (step >= target) return step;
    }
    return niceSteps[niceSteps.length - 1];
}

function aggregate(rows, groupKey) {
    const months = new Set();
    const categories = new Set();
    const totalsByCategory = new Map();
    const valuesByCategoryByMonth = new Map();

    for (const row of rows) {
        const monthKey = monthKeyFromValidFrom(row.valid_from);
        if (!monthKey) continue;
        const category = row[groupKey];
        if (category == null) continue;
        const lengthKm = Number(row.length_km ?? 0);
        if (!Number.isFinite(lengthKm) || lengthKm <= 0) continue;

        months.add(monthKey);
        categories.add(category);
        totalsByCategory.set(category, (totalsByCategory.get(category) ?? 0) + lengthKm);

        if (!valuesByCategoryByMonth.has(category)) {
            valuesByCategoryByMonth.set(category, new Map());
        }
        const monthMap = valuesByCategoryByMonth.get(category);
        monthMap.set(monthKey, (monthMap.get(monthKey) ?? 0) + lengthKm);
    }

    return {
        months: [...months].sort(),
        categories: [...categories],
        totalsByCategory,
        valuesByCategoryByMonth
    };
}

function monthKeyFromValidFrom(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function formatMonthLabel(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    if (!year || !month) return monthKey;
    const date = new Date(Date.UTC(year, month - 1, 1));
    return MONTH_FORMAT_DE.format(date);
}
