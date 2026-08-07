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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Visual } = require("../src/visual");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseDataView, resolveBaseScenario } = require("../src/dataModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { detectScenario } = require("../src/ibcs");

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
    console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? ` | ${detail}` : ""}`);
    if (!cond) {
        failures++;
    }
}

function makeHost(): unknown {
    let counter = 0;
    const builder: Record<string, unknown> = {};
    builder.withCategory = () => builder;
    builder.withSeries = () => builder;
    builder.withMeasure = () => builder;
    builder.createSelectionId = () => {
        const key = ++counter;

        return { key, equals: (o: { key: number }) => !!o && o.key === key };
    };

    return {
        createSelectionManager: () => ({
            select: async () => [],
            clear: async () => [],
            hasSelection: () => false,
            getSelectionIds: () => [],
            showContextMenu: () => undefined,
            registerOnSelectCallback: () => undefined
        }),
        createSelectionIdBuilder: () => builder,
        createLocalizationManager: () => ({ getDisplayName: (k: string) => k, getLocalization: () => "en-US" }),
        colorPalette: { getColor: () => ({ value: "#01B8AA" }) },
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
        applyJsonFilter: () => undefined
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

    return {
        metadata: { columns: [timeCol.source, scenCol.source, valCol.source] },
        categorical: { categories: [timeCol, scenCol], values: [valCol] }
    };
}

function withMode(dv: Record<string, unknown>, mode: string): unknown {
    const metadata = dv.metadata as Record<string, unknown>;
    // Real Power BI dataViews carry evaluated literals in metadata.objects.
    metadata.objects = { chart: { mode } };

    return dv;
}

function makeVisual(host: unknown): unknown {
    const el = (w.document as Document).getElementById("host") as HTMLDivElement;
    el.innerHTML = "";

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

console.log("=== render: dimension mode as table ===");
html = runUpdate(makeVisual(host), withMode(dimensionModeDataView() as Record<string, unknown>, "table"));
check("table rendered rows", (html.match(/ibcs-trow/g) ?? []).length >= 3, `trows=${(html.match(/ibcs-trow/g) ?? []).length}`);
check("table has ΔPY header", html.includes("ΔPY"));

console.log("=== render: time series mode ===");
html = runUpdate(makeVisual(host), withMode(timeSeriesDataView() as Record<string, unknown>, "timeseries"));
check("time series bars", (html.match(/<rect/g) ?? []).length >= 8, `rects=${(html.match(/<rect/g) ?? []).length}`);
check("AC series group", html.includes("ibcs-series-AC"));

console.log("=== render: waterfall mode (base PY) ===");
html = runUpdate(makeVisual(host), withMode(dvMeasures as Record<string, unknown>, "waterfall"));
check("waterfall columns", (html.match(/<rect/g) ?? []).length >= 7, `rects=${(html.match(/<rect/g) ?? []).length}`);

console.log("=== landing page (no data) ===");
html = runUpdate(makeVisual(host), null);
check("landing text", html.includes("Visual_LandingTitle") || html.includes("IBCS"), `len=${html.length}`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
