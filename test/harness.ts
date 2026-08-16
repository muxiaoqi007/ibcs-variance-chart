// Shared test harness: jsdom globals, host mock and DataView builders used by
// both the visual smoke suite and the mocha unit suite.

import { JSDOM, VirtualConsole } from "jsdom";

const virtualConsole = new VirtualConsole();
virtualConsole.on("error", (...args: unknown[]) => console.error(...args));
export const dom = new JSDOM(`<!doctype html><html><body><div id="host"></div></body></html>`, {
    pretendToBeVisual: true,
    virtualConsole
});
export const w = dom.window as unknown as Record<string, unknown>;

/** Expose browser globals so bundled d3/mocha code runs under plain node. */
export function installGlobals(): void {
    const setGlobal = (name: string, value: unknown): void => {
        Object.defineProperty(global, name, { value, writable: true, configurable: true });
    };
    setGlobal("window", dom.window);
    setGlobal("document", w.document);
    setGlobal("navigator", w.navigator);
    setGlobal("location", dom.window.location);
    setGlobal("HTMLElement", w.HTMLElement);
    setGlobal("Element", w.Element);
    setGlobal("Node", w.Node);
    setGlobal("SVGElement", w.SVGElement);
    setGlobal("getComputedStyle", w.getComputedStyle);
    setGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(cb, 0));
}

// Mirrors the user report: ATC4 category + ALL_CITY (AC) + ALL_CITY_LY (PY).
export function measureModeDataView(): Record<string, unknown> {
    const catCol = {
        identity: [],
        source: { displayName: "ATC4", queryName: "ATC4", roles: { category: true }, type: { textual: true } },
        values: ["麻醉重症", "降糖药", "肝病消化", "止吐", "神经病理"]
    };
    const acCol = {
        source: { displayName: "ALL_CITY", queryName: "ac", roles: { ac: true }, format: "#,0.00" },
        values: [36.4e9, 36.1e9, 28.9e9, 2.6e9, 1.7e9]
    };
    const pyCol = {
        source: { displayName: "ALL_CITY_LY", queryName: "py", roles: { py: true }, format: "#,0.00" },
        values: [33.5e9, 26.3e9, 24.2e9, 0.9e9, 1.29e9]
    };

    return {
        metadata: { columns: [catCol.source, acCol.source, pyCol.source] },
        categorical: { categories: [catCol], values: [acCol, pyCol] }
    };
}

export function dimensionModeDataView(): Record<string, unknown> {
    const catVals: string[] = [];
    const scenVals: string[] = [];
    const vals: number[] = [];
    const data: Record<string, Record<string, number>> = {
        麻醉重症: { AC: 36.4e9, PY: 33.5e9, PL: 35e9 },
        降糖药: { AC: 36.1e9, PY: 26.3e9, PL: 30e9 },
        肝病消化: { AC: 28.9e9, PY: 24.2e9, PL: 27e9 }
    };
    for (const [cat, scens] of Object.entries(data)) {
        for (const [scen, v] of Object.entries(scens)) {
            catVals.push(cat);
            scenVals.push(scen);
            vals.push(v);
        }
    }
    const catCol = { identity: [], source: { displayName: "ATC4", roles: { category: true } }, values: catVals };
    const scenCol = { identity: [], source: { displayName: "Scenario", roles: { scenario: true } }, values: scenVals };
    const valCol = { source: { displayName: "Sales", queryName: "value", roles: { value: true }, format: "#,0" }, values: vals };

    return {
        metadata: { columns: [catCol.source, scenCol.source, valCol.source] },
        categorical: { categories: [catCol, scenCol], values: [valCol] }
    };
}

export function timeSeriesDataView(): Record<string, unknown> {
    const timeVals: string[] = [];
    const scenVals: string[] = [];
    const vals: number[] = [];
    const months = ["202601", "202602", "202603", "202604"];
    months.forEach((m, i) => {
        timeVals.push(m, m);
        scenVals.push("AC", "PY");
        vals.push(10e9 + i * 1e9, 8e9 + i * 0.8e9);
    });
    const timeCol = { identity: [], source: { displayName: "Month", roles: { timeAxis: true } }, values: timeVals };
    const scenCol = { identity: [], source: { displayName: "Scenario", roles: { scenario: true } }, values: scenVals };
    const valCol = { source: { displayName: "Sales", queryName: "value", roles: { value: true }, format: "#,0" }, values: vals };
    const tooltipCol = {
        source: { displayName: "Margin", queryName: "margin", roles: { tooltips: true }, format: "0.0%" },
        values: months.flatMap((_m, i) => [0.2 + i * 0.01, 0.2 + i * 0.01])
    };

    return {
        metadata: { columns: [timeCol.source, scenCol.source, valCol.source, tooltipCol.source] },
        categorical: { categories: [timeCol, scenCol], values: [valCol, tooltipCol] }
    };
}

export function duplicateLabelDataView(): Record<string, unknown> {
    const categoryCol = {
        identity: [{ key: "north" }, { key: "north" }, { key: "south" }, { key: "south" }],
        source: { displayName: "Branch", roles: { category: true } },
        values: ["Central", "Central", "Central", "Central"]
    };
    const scenarioCol = {
        source: { displayName: "Scenario", roles: { scenario: true } },
        values: ["AC", "PY", "AC", "PY"]
    };
    const valueCol = {
        source: { displayName: "Sales", roles: { value: true } },
        values: [10, 8, 20, 15]
    };

    return {
        metadata: { columns: [categoryCol.source, scenarioCol.source, valueCol.source] },
        categorical: { categories: [categoryCol, scenarioCol], values: [valueCol] }
    };
}

export function manyRowsDataView(): Record<string, unknown> {
    const count = 40;
    const categoryCol = {
        identity: [],
        source: { displayName: "Category", roles: { category: true } },
        values: Array.from({ length: count }, (_v, i) => `Item ${i + 1}`)
    };
    const acCol = {
        source: { displayName: "AC", roles: { ac: true } },
        values: Array.from({ length: count }, (_v, i) => 100 - i)
    };
    const pyCol = {
        source: { displayName: "PY", roles: { py: true } },
        values: Array.from({ length: count }, (_v, i) => 90 - i)
    };

    return {
        metadata: { columns: [categoryCol.source, acCol.source, pyCol.source] },
        categorical: { categories: [categoryCol], values: [acCol, pyCol] }
    };
}

export function topNDataView(mode: "items" | "percentage", limit: number): Record<string, unknown> {
    const categoryCol = {
        identity: [],
        source: { displayName: "Category", roles: { category: true } },
        values: ["Alpha", "Beta", "Gamma", "Delta"]
    };
    const acCol = {
        source: { displayName: "AC", roles: { ac: true } },
        values: [60, 30, 10, 5]
    };
    const pyCol = {
        source: { displayName: "PY", roles: { py: true } },
        values: [40, 20, 8, 4]
    };

    return {
        metadata: {
            columns: [categoryCol.source, acCol.source, pyCol.source],
            objects: {
                topN: {
                    mode,
                    count: limit,
                    percentage: limit,
                    rankBy: "ac",
                    includeOthers: true
                }
            }
        },
        categorical: { categories: [categoryCol], values: [acCol, pyCol] }
    };
}

/** Attach highlight arrays so only `highlightedIndexes` rows stay lit. */
export function withHighlights(dv: Record<string, unknown>, highlightedIndexes: number[]): Record<string, unknown> {
    const categorical = dv.categorical as { values: Array<Record<string, unknown>> };
    categorical.values.forEach((col) => {
        col.highlights = (col.values as number[]).map((v, i) => (highlightedIndexes.includes(i) ? v : null));
    });

    return dv;
}

export function withMode(dv: Record<string, unknown>, mode: string): Record<string, unknown> {
    const metadata = dv.metadata as Record<string, unknown>;
    // Real Power BI dataViews carry evaluated literals in metadata.objects.
    metadata.objects = { ...(metadata.objects as Record<string, unknown> ?? {}), chart: { mode } };

    return dv;
}

export function withTotals(dv: Record<string, unknown>, mode: string): Record<string, unknown> {
    const metadata = dv.metadata as Record<string, unknown>;
    metadata.objects = { ...(metadata.objects as Record<string, unknown> ?? {}), chart: { mode, showTotals: true } };

    return dv;
}

export function makeHost(highContrast = false): Record<string, unknown> {
    let counter = 0;
    let identityKey: string | null = null;
    const selectedTargets: unknown[] = [];
    const builder: Record<string, unknown> = {};
    builder.withCategory = (column: { identity?: Array<{ key?: string }> }, index: number) => {
        const values = (column as { values?: unknown[] }).values;
        identityKey = column.identity?.[index]?.key ?? String(values?.[index] ?? index);

        return builder;
    };
    builder.withSeries = () => builder;
    builder.withMeasure = () => builder;
    builder.createSelectionId = () => {
        const key = identityKey ?? String(++counter);
        const hasIdentity = identityKey !== null;
        identityKey = null;

        return {
            key,
            equals: (o: { key: string }) => !!o && o.key === key,
            getKey: () => key,
            hasIdentity: () => hasIdentity
        };
    };

    return {
        createSelectionManager: () => ({
            select: async (target: unknown) => {
                const targets = Array.isArray(target) ? target : [target];
                if (targets.some((item) => !(item as { hasIdentity?: () => boolean })?.hasIdentity?.())) {
                    throw new Error("Selection contained an empty identity");
                }
                selectedTargets.push(target);

                return targets;
            },
            clear: async () => [],
            hasSelection: () => false,
            getSelectionIds: () => [],
            showContextMenu: () => undefined,
            registerOnSelectCallback: () => undefined
        }),
        createSelectionIdBuilder: () => builder,
        createLocalizationManager: () => ({
            getDisplayName: (k: string) => {
                if (k === "Visual_MoreRows") {
                    return "+{0} more items";
                }
                if (k === "Visual_Tooltip_Category") {
                    return "Category";
                }

                return k;
            },
            getLocalization: () => "en-US"
        }),
        colorPalette: {
            isHighContrast: highContrast,
            foreground: { value: "#FFFFFF" },
            background: { value: "#000000" },
            getColor: () => ({ value: "#01B8AA" })
        },
        tooltipService: { enabled: () => true, show: () => undefined, hide: () => undefined },
        eventService: {
            renderingStarted: () => undefined,
            renderingFinished: () => undefined,
            renderingFailed: (_o: unknown, _message?: string) => undefined
        },
        hostCapabilities: { allowInteractions: true },
        persistProperties: () => undefined,
        applyJsonFilter: () => undefined,
        __selectedTargets: selectedTargets
    };
}

export function makeVisual(host: unknown): { update: (o: unknown) => void } {
    // Lazy require so unit suites that never touch the visual can skip the
    // less/CSS import cost.
    const { Visual } = require("../src/visual");
    const el = (w.document as Document).getElementById("host") as HTMLDivElement;
    el.replaceChildren();

    return new Visual({ element: el, host }) as { update: (o: unknown) => void };
}

export function runUpdate(
    visual: { update: (o: unknown) => void },
    dv: unknown,
    width = 900,
    height = 420
): string {
    visual.update({
        dataViews: dv ? [dv] : [],
        viewport: { width, height },
        type: 2,
        viewMode: 0,
        editMode: 0,
        operationKind: 0
    });
    const el = (w.document as Document).getElementById("host") as HTMLDivElement;

    return el.innerHTML;
}
