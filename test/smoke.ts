// Smoke test: reproduces PBI dataViews and drives the Visual end-to-end in jsdom.
// Shared mocks/builders live in test/harness.ts; pure-logic coverage lives in
// test/unit.spec.ts (mocha).

import {
    dom,
    w,
    makeHost,
    measureModeDataView,
    dimensionModeDataView,
    timeSeriesDataView,
    duplicateLabelDataView,
    manyRowsDataView,
    topNDataView,
    withMode,
    withTotals,
    withHighlights,
    makeVisual,
    runUpdate
} from "./harness";
import { installGlobals } from "./harness";

installGlobals();
import { parseDataView, resolveBaseScenario } from "../src/dataModel";
import { detectScenario } from "../src/ibcs";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
    console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? ` | ${detail}` : ""}`);
    if (!cond) {
        failures++;
    }
}

// Hosts used by render assertions must turn rendering failures into test
// failures; the harness default is silent.
function newHost(highContrast = false): Record<string, unknown> {
    const host = makeHost(highContrast);
    (host.eventService as Record<string, unknown>).renderingFailed = (_o: unknown, message?: string) => {
        console.log("RENDERING_FAILED_EVENT:", message);
        failures++;
    };

    return host;
}

function multiComparisonDataView(mode: "variance" | "table" | "waterfall"): unknown {
    const dataView = dimensionModeDataView();
    const metadata = dataView.metadata as Record<string, unknown>;
    metadata.objects = {
        chart: { mode },
        scenarios: { comparisonMode: "all", baseScenario: "auto" }
    };

    return dataView;
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
const host = newHost();
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
const formattingVisual = makeVisual(newHost()) as {
    update: (options: unknown) => void;
    getFormattingModel: () => { cards?: Array<{ uid?: string; groups?: Array<{ slices?: unknown[] }> }> };
    formattingSettingsService: {
        populateFormattingSettingsModel: (...args: unknown[]) => unknown;
        buildFormattingModel: (...args: unknown[]) => unknown;
    };
};
const formattingModel = formattingVisual.getFormattingModel();
check("custom formatting cards are registered", (formattingModel.cards?.length ?? 0) === 8);
check("notation formatting card is registered", formattingModel.cards?.some((card) => card.uid === "notation-card") === true);
const originalPopulate = formattingVisual.formattingSettingsService.populateFormattingSettingsModel;
formattingVisual.formattingSettingsService.populateFormattingSettingsModel = () => {
    throw "stale formatting metadata";
};
html = runUpdate(formattingVisual, measureModeDataView());
check("stale formatting metadata cannot blank the visual", html.includes("ibcs-ac-bar"));
formattingVisual.formattingSettingsService.populateFormattingSettingsModel = originalPopulate;

const errorHost = newHost() as Record<string, unknown>;
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
const topNHost = newHost() as { __selectedTargets: unknown[] };
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
html = runUpdate(makeVisual(newHost(true)), measureModeDataView());
check("high contrast uses host foreground", html.includes('fill="#FFFFFF"'));

console.log("=== cross-visual highlight ===");
const caps = require("../capabilities.json");
check("supportsHighlight declared in capabilities", caps.supportsHighlight === true);
const highlightDv = measureModeDataView() as {
    categorical: { values: Array<Record<string, unknown>> };
};
highlightDv.categorical.values.forEach((col) => {
    col.highlights = (col.values as number[]).map((v, i) => (i === 0 ? v : null));
});
const parsedHl = parseDataView(highlightDv, host);
check("highlight data parsed", parsedHl?.hasHighlight === true);
check("highlighted row detected", parsedHl?.rows[0]?.highlighted === true);
check("non-highlighted rows detected", parsedHl?.rows.slice(1).every((r) => r.highlighted === false) === true);
html = runUpdate(makeVisual(host), highlightDv);
check("highlight dims non-selected rows", html.includes('opacity="0.35"'));
html = runUpdate(makeVisual(host), measureModeDataView());
check("no dimming without highlight values", !html.includes('opacity="0.35"'));

console.log("=== keyed data joins reuse DOM across updates ===");
const reuseVisual = makeVisual(host) as { update: (o: unknown) => void };
runUpdate(reuseVisual, measureModeDataView());
const firstRowBefore = (w.document as Document).querySelector("g.ibcs-row");
const rowSeparatorBefore = (w.document as Document).querySelector("g.ibcs-row line.ibcs-sep");
runUpdate(reuseVisual, measureModeDataView());
check("row DOM nodes are reused across updates", firstRowBefore === (w.document as Document).querySelector("g.ibcs-row"));
check("row separators are not duplicated", (w.document as Document).querySelectorAll("g.ibcs-row > line.ibcs-sep").length === 4);
const shrunkDv = measureModeDataView() as {
    categorical: { categories: Array<Record<string, unknown>>; values: Array<Record<string, unknown>> };
};
shrunkDv.categorical.categories[0].values = ["麻醉重症", "降糖药"];
shrunkDv.categorical.values.forEach((col) => {
    col.values = (col.values as number[]).slice(0, 2);
});
runUpdate(reuseVisual, shrunkDv);
check("shrunk data removes stale rows", (w.document as Document).querySelectorAll("g.ibcs-row").length === 2);

console.log("=== render: vertical variance mode ===");
html = runUpdate(makeVisual(host), withMode(measureModeDataView() as Record<string, unknown>, "vertical"));
check("vertical AC columns rendered", (html.match(/ibcs-vac-bar/g) ?? []).length === 5);
check("vertical base outlines rendered", (html.match(/ibcs-vbase-bar/g) ?? []).length === 5);
check("vertical delta bars rendered", (html.match(/ibcs-vdelta-bar/g) ?? []).length === 5);
check("vertical ΔPY header present", html.includes("ΔPY"));
check("vertical pct lollipops rendered", (html.match(/ibcs-vpct-dot/g) ?? []).length === 5);
check("vertical category labels rendered", html.includes("麻醉重症"));
const verticalHit = (w.document as Document).querySelector("g.ibcs-vcol rect.ibcs-hit");
check("vertical columns expose interaction targets", verticalHit?.getAttribute("tabindex") === "0");
const verticalHost = newHost() as { __selectedTargets: unknown[] };
html = runUpdate(makeVisual(verticalHost), withMode(measureModeDataView() as Record<string, unknown>, "vertical"));
(w.document as Document).querySelector("g.ibcs-vcol rect.ibcs-hit")?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
check("clicking a vertical column selects its category", verticalHost.__selectedTargets.length === 1);
html = runUpdate(makeVisual(host), withMode(measureModeDataView() as Record<string, unknown>, "vertical"), 200, 240);
check("narrow vertical chart drops the percent panel", !html.includes(">ΔPY%<") && html.includes(">ΔPY<"));
html = runUpdate(makeVisual(host), withMode(manyRowsDataView() as Record<string, unknown>, "vertical"), 900, 420);
check("vertical overflow note appears", html.includes("ibcs-overflow-note") && (html.match(/ibcs-vcol/g) ?? []).length < 40);

console.log("=== totals row ===");
html = runUpdate(makeVisual(host), withTotals(measureModeDataView() as Record<string, unknown>, "table"));
check("table totals row rendered", html.includes("ibcs-ttotal") && html.includes("Visual_Total"));
check("table totals AC sums all rows", html.includes("105.70bn"), html.slice(html.indexOf("ibcs-ttotal"), html.indexOf("ibcs-ttotal") + 600));
check("table totals delta derived from sums", html.includes("+19.51bn"));
check("table totals pct derived from sums", html.includes("+22.6%"));
const totalsHit = (w.document as Document).querySelector("g.ibcs-ttotal rect.ibcs-hit");
check("table totals row is not selectable", totalsHit?.getAttribute("tabindex") === null);
html = runUpdate(makeVisual(host), withTotals(measureModeDataView() as Record<string, unknown>, "variance"));
check("variance totals row rendered", html.includes("ibcs-total") && html.includes("Visual_Total"));
check("variance totals AC bar and value rendered", html.includes("ibcs-total-ac-bar") && html.includes("105.70bn"));
html = runUpdate(makeVisual(host), measureModeDataView());
check("totals row hidden by default", !html.includes("ibcs-ttotal") && !html.includes("ibcs-total"));
html = runUpdate(makeVisual(host), withTotals(dimensionModeDataView() as Record<string, unknown>, "table"));
check("totals works with dimension mode", html.includes("ibcs-ttotal") && /101(\.4)?0?bn/.test(html), html.slice(html.indexOf("ibcs-tcell-ac"), html.indexOf("ibcs-tcell-ac") + 120));

console.log("=== gridlines and row fill ===");
html = runUpdate(makeVisual(host), measureModeDataView());
check("row separators shown by default", html.includes("ibcs-sep"));
check("fill mode stretches rows across the plot", (() => {
    const rowsEls = Array.from((w.document as Document).querySelectorAll<SVGGElement>("g.ibcs-row"));
    return rowsEls.length === 5 && Number(rowsEls[1].getAttribute("transform")?.match(/translate\(0, ([0-9.]+)\)/)?.[1]) > 60;
})());
const noGridDv = measureModeDataView();
(noGridDv.metadata as Record<string, unknown>).objects = { gridlines: { show: false } };
html = runUpdate(makeVisual(host), noGridDv);
check("gridlines can be hidden", !html.includes("ibcs-sep"));
const gridColorDv = measureModeDataView();
(gridColorDv.metadata as Record<string, unknown>).objects = { gridlines: { color: { solid: { color: "#FF0000" } } } };
html = runUpdate(makeVisual(host), gridColorDv);
check("gridline color is applied", html.includes('stroke="#FF0000"'), html.slice(html.indexOf("ibcs-sep") - 60, html.indexOf("ibcs-sep") + 60));
html = runUpdate(makeVisual(host), withMode(measureModeDataView() as Record<string, unknown>, "table"));
check("table fill mode stretches rows", (() => {
    const rowsEls = Array.from((w.document as Document).querySelectorAll<SVGGElement>("g.ibcs-trow"));
    return rowsEls.length === 5 && Number(rowsEls[1].getAttribute("transform")?.match(/translate\(0, ([0-9.]+)\)/)?.[1]) > 44;
})());

console.log("=== outlier scaling ===");
function outlierDataView(): Record<string, unknown> {
    const catCol = {
        identity: [],
        source: { displayName: "ATC4", roles: { category: true } },
        values: ["麻醉重症", "降糖药", "肝病消化", "止吐"]
    };
    const acCol = {
        source: { displayName: "AC", roles: { ac: true }, format: "#,0" },
        values: [100e9, 30e9, 25e9, 20e9]
    };
    const pyCol = {
        source: { displayName: "PY", roles: { py: true }, format: "#,0" },
        values: [80e9, 20e9, 25e9, 10e9]
    };

    return {
        metadata: { columns: [catCol.source, acCol.source, pyCol.source] },
        categorical: { categories: [catCol], values: [acCol, pyCol] }
    };
}
html = runUpdate(makeVisual(host), outlierDataView());
check("outlier row gets break marks", html.includes("ibcs-break"), html.slice(0, 200));
const acTexts = (html.match(/ibcs-ac-value[^>]*>([^<]*)</g) ?? []).map((s) => s.replace(/^.*>/, "").replace(/<$/, ""));
check("outlier row keeps its true value label", acTexts.some((t) => /^0\.1T$|^100/.test(t)), acTexts.join(" / "));
const outlierBarWidths = Array.from((w.document as Document).querySelectorAll<SVGRectElement>("g.ibcs-row rect.ibcs-ac-bar")).map((b) => Number(b.getAttribute("width")));
check("outlier scaling magnifies the normal rows", outlierBarWidths.length === 4 && outlierBarWidths[1] > outlierBarWidths[0] * 0.8, outlierBarWidths.join(","));
const outlierOffDv = outlierDataView();
(outlierOffDv.metadata as Record<string, unknown>).objects = { notation: { outlierScale: "off" } };
html = runUpdate(makeVisual(host), outlierOffDv);
check("outlier scaling can be disabled", !html.includes("ibcs-break"));
const normalBarWidths = Array.from((w.document as Document).querySelectorAll<SVGRectElement>("g.ibcs-row rect.ibcs-ac-bar")).map((b) => Number(b.getAttribute("width")));
check("disabled mode uses the true scale again", normalBarWidths.length === 4 && normalBarWidths[1] < normalBarWidths[0] / 2, normalBarWidths.join(","));
console.log("=== render: waterfall mode (base PY) ===");
const waterfallHost = newHost() as { __selectedTargets: unknown[] };
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
