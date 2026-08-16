// Smoke test: reproduces PBI dataViews and drives the Visual end-to-end in jsdom.

import { JSDOM, VirtualConsole } from "jsdom";

const virtualConsole = new VirtualConsole();
virtualConsole.on("error", (...args: unknown[]) => console.error(...args));
const dom = new JSDOM(`<!doctype html><html><body><div id="host"></div></body></html>`, {
    pretendToBeVisual: true,
    virtualConsole
});
const w = dom.window as unknown as Record<string, unknown>;
function setGlobal(name: string, value: unknown): void {
    Object.defineProperty(global, name, { value, writable: true, configurable: true });
}
setGlobal("window", dom.window);
setGlobal("document", w.document);
setGlobal("navigator", w.navigator);
setGlobal("HTMLElement", w.HTMLElement);
setGlobal("Element", w.Element);
setGlobal("Node", w.Node);
setGlobal("SVGElement", w.SVGElement);
setGlobal("getComputedStyle", w.getComputedStyle);
setGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(cb, 0));

const { Visual } = require("../src/visual");
const { parseDataView, resolveBaseScenario } = require("../src/dataModel");
const { detectScenario } = require("../src/ibcs");

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
    console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? ` | ${detail}` : ""}`);
    if (!cond) {
        failures++;
    }
}

function makeHost(highContrast = false): unknown {
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
            renderingFailed: (_o: unknown, message?: string) => {
                console.log("RENDERING_FAILED_EVENT:", message);
                failures++;
            }
        },
        hostCapabilities: { allowInteractions: true },
        persistProperties: () => undefined,
        applyJsonFilter: () => undefined,
        __selectedTargets: selectedTargets
    };
}

// Mirrors the user report: ATC4 category + ALL_CITY (AC) + ALL_CITY_LY (PY).
function measureModeDataView(): unknown {
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

function dimensionModeDataView(): unknown {
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

function timeSeriesDataView(): unknown {
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

function duplicateLabelDataView(): unknown {
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

function manyRowsDataView(): unknown {
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

function topNDataView(mode: "items" | "percentage", limit: number): unknown {
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

function multiComparisonDataView(mode: "variance" | "table" | "waterfall"): unknown {
    const dataView = dimensionModeDataView() as Record<string, unknown>;
    const metadata = dataView.metadata as Record<string, unknown>;
    metadata.objects = {
        chart: { mode },
        scenarios: { comparisonMode: "all", baseScenario: "auto" }
    };

    return dataView;
}

function withMode(dv: Record<string, unknown>, mode: string): unknown {
    const metadata = dv.metadata as Record<string, unknown>;
    // Real Power BI dataViews carry evaluated literals in metadata.objects.
    metadata.objects = { ...(metadata.objects as Record<string, unknown> ?? {}), chart: { mode } };

    return dv;
}

function makeVisual(host: unknown): unknown {
    const el = (w.document as Document).getElementById("host") as HTMLDivElement;
    el.replaceChildren();

    return new Visual({ element: el, host });
}

function runUpdate(visual: { update: (o: unknown) => void }, dv: unknown, width = 900, height = 420): string {
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

console.log("=== scenario detection ===");
check("detect ACTUAL -> AC", detectScenario("ACTUAL") === "AC");
check("detect 实际 -> AC", detectScenario("实际") === "AC");
check("detect LY -> PY", detectScenario("LY") === "PY");
check("detect 上年 -> PY", detectScenario("上年") === "PY");
check("detect Budget -> PL", detectScenario("Budget") === "PL");
check("detect FC 2026 -> FC", detectScenario("FC 2026") === "FC");
check("detect SPACE -> UNKNOWN (no false positive)", detectScenario("SPACE") === "UNKNOWN");

console.log("=== parse: dedicated measures (user scenario) ===");
const host = makeHost();
const dvMeasures = measureModeDataView();
const parsedM = parseDataView(dvMeasures, host);
check("parsed not null", !!parsedM);
check("rows = 5", parsedM?.rows.length === 5, `rows=${parsedM?.rows.length}`);
check("AC present", parsedM?.present.includes("AC"));
check("PY present", parsedM?.present.includes("PY"));
check("base resolves to PY", resolveBaseScenario("auto", parsedM?.present ?? []) === "PY");
const row0 = parsedM?.rows[0];
check("row0 AC value", row0?.values.AC === 36.4e9, `AC=${row0?.values.AC}`);
check("row0 PY value", row0?.values.PY === 33.5e9, `PY=${row0?.values.PY}`);

console.log("=== render: variance mode with dedicated measures ===");
let html = runUpdate(makeVisual(host), dvMeasures);
check("svg has content", html.includes("<svg"), `len=${html.length}`);
check("AC bars rendered", html.includes("ibcs-ac-bar"), `rects=${(html.match(/<rect/g) ?? []).length}`);
check("delta bars rendered", html.includes("ibcs-delta-bar"));
check("ΔPY header present", html.includes("ΔPY"));
check("labels present", (html.match(/<text/g) ?? []).length >= 5, `texts=${(html.match(/<text/g) ?? []).length}`);

console.log("=== formatting model and runtime recovery ===");
const formattingVisual = makeVisual(makeHost()) as {
    update: (options: unknown) => void;
    getFormattingModel: () => { cards?: Array<{ uid?: string; groups?: Array<{ slices?: unknown[] }> }> };
    formattingSettingsService: {
        populateFormattingSettingsModel: (...args: unknown[]) => unknown;
        buildFormattingModel: (...args: unknown[]) => unknown;
    };
};
const formattingModel = formattingVisual.getFormattingModel();
check("custom formatting cards are registered", (formattingModel.cards?.length ?? 0) === 7);
check("notation formatting card is registered", formattingModel.cards?.some((card) => card.uid === "notation-card") === true);
const originalPopulate = formattingVisual.formattingSettingsService.populateFormattingSettingsModel;
formattingVisual.formattingSettingsService.populateFormattingSettingsModel = () => {
    throw "stale formatting metadata";
};
html = runUpdate(formattingVisual, measureModeDataView());
check("stale formatting metadata cannot blank the visual", html.includes("ibcs-ac-bar"));
formattingVisual.formattingSettingsService.populateFormattingSettingsModel = originalPopulate;

const errorHost = makeHost() as Record<string, unknown>;
errorHost.eventService = {
    renderingStarted: () => undefined,
    renderingFinished: () => undefined,
    renderingFailed: () => undefined
};
Object.defineProperty(errorHost, "colorPalette", {
    get: () => {
        throw "simulated host failure";
    }
});
html = runUpdate(makeVisual(errorHost), measureModeDataView());
check("non-Error host failures render a visible diagnostic", html.includes("Render error") && html.includes("simulated host failure"));

console.log("=== sort: persisted sortSettings (ac asc) ===");
const dvSorted = measureModeDataView() as Record<string, unknown>;
(dvSorted.metadata as Record<string, unknown>).objects = { sortSettings: { field: "ac", direction: "asc" } };
html = runUpdate(makeVisual(host), dvSorted);
const iSmallest = html.indexOf("神经病理");
const iLargest = html.indexOf("麻醉重症");
check("asc sort puts smallest AC first", iSmallest !== -1 && iLargest !== -1 && iSmallest < iLargest, `small=${iSmallest} large=${iLargest}`);
check("sorted header arrow shown", html.includes("AC↑") || html.includes("AC \u2191"), "");

console.log("=== parse: scenario dimension ===");
const parsedD = parseDataView(dimensionModeDataView(), host);
check("dimension parsed", !!parsedD && parsedD.rows.length === 3, `rows=${parsedD?.rows.length}`);
check("dimension pivot AC", parsedD?.rows[0]?.values.AC === 36.4e9);
check("dimension pivot PL", parsedD?.rows[0]?.values.PL === 35e9);

console.log("=== parse: duplicate labels preserve distinct identities ===");
const parsedDuplicates = parseDataView(duplicateLabelDataView(), host);
check("duplicate display labels remain distinct", parsedDuplicates?.rows.length === 2, `rows=${parsedDuplicates?.rows.length}`);
check("first duplicate identity aggregates scenarios", parsedDuplicates?.rows[0]?.values.AC === 10 && parsedDuplicates?.rows[0]?.values.PY === 8);
check("second duplicate identity aggregates scenarios", parsedDuplicates?.rows[1]?.values.AC === 20 && parsedDuplicates?.rows[1]?.values.PY === 15);

console.log("=== render: dimension mode as table ===");
html = runUpdate(makeVisual(host), withMode(dimensionModeDataView() as Record<string, unknown>, "table"));
check("table rendered rows", (html.match(/ibcs-trow/g) ?? []).length >= 3, `trows=${(html.match(/ibcs-trow/g) ?? []).length}`);
check("table has ΔPY header", html.includes("ΔPY"));

console.log("=== render: time series mode ===");
html = runUpdate(makeVisual(host), withMode(timeSeriesDataView() as Record<string, unknown>, "timeseries"));
check("time series bars", (html.match(/<rect/g) ?? []).length >= 8, `rects=${(html.match(/<rect/g) ?? []).length}`);
check("AC series group", html.includes("ibcs-series-AC"));
check("time series includes extra tooltip", html.includes("Margin:"));
check("data points expose keyboard semantics", html.includes('tabindex="0"') && html.includes('role="button"'));

console.log("=== responsive density ===");
html = runUpdate(makeVisual(host), manyRowsDataView(), 480, 120);
check("overflow note appears", html.includes("ibcs-overflow-note") && html.includes("more items"));
check("only visible rows are rendered", (html.match(/ibcs-row/g) ?? []).length < 40);
html = runUpdate(makeVisual(host), withMode(measureModeDataView() as Record<string, unknown>, "table"), 120, 180);
check("narrow table drops variance headers", !html.includes(">ΔPY<") && !html.includes(">ΔPY%<"));

console.log("=== table row height ===");
const fixedRowHeightView = withMode(measureModeDataView() as Record<string, unknown>, "table") as Record<string, unknown>;
const fixedRowHeightMetadata = fixedRowHeightView.metadata as Record<string, unknown>;
fixedRowHeightMetadata.objects = {
    ...(fixedRowHeightMetadata.objects as Record<string, unknown>),
    notation: { rowHeight: 40 }
};
html = runUpdate(makeVisual(host), fixedRowHeightView, 900, 420);
check("configured table row height is applied", html.includes('translate(0, 40)'));
check("configured row height preserves values", html.includes("36.40bn") || html.includes("36,400,000,000"), html);
const tableRow = (w.document as Document).querySelector("g.ibcs-trow");
check("table hit area stays behind values", tableRow?.firstElementChild?.classList.contains("ibcs-hit") === true);
const fixedVarianceHeightView = measureModeDataView() as Record<string, unknown>;
const fixedVarianceHeightMetadata = fixedVarianceHeightView.metadata as Record<string, unknown>;
fixedVarianceHeightMetadata.objects = { notation: { rowHeight: 40 } };
html = runUpdate(makeVisual(host), fixedVarianceHeightView, 900, 420);
check("configured variance row height is applied", html.includes('translate(0, 40)'));
check("configured variance row height preserves values", html.includes("36.40bn") || html.includes("36,400,000,000"));
const varianceRow = (w.document as Document).querySelector("g.ibcs-row");
check("variance hit area stays behind content", varianceRow?.firstElementChild?.classList.contains("ibcs-hit") === true);

console.log("=== Top N + Others ===");
const topNHost = makeHost() as { __selectedTargets: unknown[] };
html = runUpdate(makeVisual(topNHost), topNDataView("items", 2));
check("item Top N keeps requested items plus Others", (html.match(/ibcs-row/g) ?? []).length === 3);
check("item Top N includes Others", html.includes("Visual_Others"));
check("item Top N excludes lower ranked labels", !html.includes("Gamma") && !html.includes("Delta"));
const othersHit = (w.document as Document).querySelector("g.ibcs-row:last-of-type rect.ibcs-hit") as SVGRectElement;
othersHit.dispatchEvent(new (w.MouseEvent as typeof MouseEvent)("click", { bubbles: true }));
check("clicking Others selects all aggregated identities", Array.isArray(topNHost.__selectedTargets[0]) && (topNHost.__selectedTargets[0] as unknown[]).length === 2);
html = runUpdate(makeVisual(host), topNDataView("percentage", 80));
check("percentage Top N reaches cumulative threshold", html.includes("Alpha") && html.includes("Beta") && !html.includes("Gamma"));
html = runUpdate(makeVisual(host), withMode(topNDataView("items", 2) as Record<string, unknown>, "waterfall"));
check("Top N applies to waterfall", html.includes("Visual_Others") && !html.includes("Gamma"));

console.log("=== multiple comparisons ===");
html = runUpdate(makeVisual(host), multiComparisonDataView("variance"), 900, 660);
check("variance renders PY and PL panels", html.includes("ibcs-comparison-PY") && html.includes("ibcs-comparison-PL"));
check("variance panel headers identify both bases", html.includes("ΔPY") && html.includes("ΔPL"));
html = runUpdate(makeVisual(host), multiComparisonDataView("table"), 900, 660);
check("table renders multiple comparison panels", (html.match(/ibcs-comparison-panel/g) ?? []).length === 2);
html = runUpdate(makeVisual(host), multiComparisonDataView("waterfall"), 900, 660);
check("waterfall renders multiple comparison panels", html.includes("ibcs-comparison-PY") && html.includes("ibcs-comparison-PL"));

console.log("=== high contrast ===");
html = runUpdate(makeVisual(makeHost(true)), measureModeDataView());
check("high contrast uses host foreground", html.includes('fill="#FFFFFF"'));

console.log("=== render: waterfall mode (base PY) ===");
const waterfallHost = makeHost() as { __selectedTargets: unknown[] };
html = runUpdate(makeVisual(waterfallHost), withMode(measureModeDataView() as Record<string, unknown>, "waterfall"));
check("waterfall columns", (html.match(/<rect/g) ?? []).length >= 7, `rects=${(html.match(/<rect/g) ?? []).length}`);
const waterfallHits = Array.from((w.document as Document).querySelectorAll<SVGRectElement>(".ibcs-wf-hit"));
check("every waterfall column has an interaction target", waterfallHits.length === 7, `hits=${waterfallHits.length}`);
check(
    "small waterfall steps have a 24px interaction target",
    waterfallHits.slice(1, -1).every((hit) => Number(hit.getAttribute("height")) >= 24)
);
check("waterfall tooltip includes category name", html.includes("Category: 麻醉重症"));
waterfallHits[2]?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
check("clicking an expanded waterfall target selects its category", waterfallHost.__selectedTargets.length === 1);

console.log("=== landing page (no data) ===");
html = runUpdate(makeVisual(host), null);
check("landing text", html.includes("Visual_LandingTitle") || html.includes("IBCS"), `len=${html.length}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
