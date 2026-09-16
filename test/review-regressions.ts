import { installGlobals, makeHost, makeVisual, runUpdate, withMode, duplicateLabelDataView } from "./harness";
import { parseDataView } from "../src/dataModel";

export function reviewRegressions(check: (name: string, condition: boolean) => void): void {
    installGlobals();
    const data = (ac: Array<number | null>, py: Array<number | null>, pl?: number[]): any => {
        const category = { source: { displayName: "Category", roles: { category: true } }, values: ac.map((_, i) => `Item ${i}`) };
        const values: any[] = [
            { source: { displayName: "Sales", roles: { ac: true }, format: "#,0" }, values: ac },
            { source: { displayName: "Last week", roles: { py: true }, format: "#,0" }, values: py }
        ];
        if (pl) values.push({ source: { displayName: "Plan", roles: { pl: true }, format: "#,0" }, values: pl });
        return { metadata: { columns: [category.source, ...values.map(v => v.source)] }, categorical: { categories: [category], values } };
    };
    const render = (dv: any, mode: string, width = 900): SVGSVGElement => {
        const host = makeHost();
        (host.eventService as any).renderingFailed = (_: unknown, message: string) => { throw new Error(message); };
        runUpdate(makeVisual(host), withMode(dv, mode), width);
        return document.querySelector("svg") as SVGSVGElement;
    };
    let svg = render(data([100, 50, null], [80, null, 30]), "waterfall");
    const columns = Array.from(svg.querySelectorAll(".ibcs-wf-column")).map((node: any) => node.__data__);
    check("waterfall preserves both one-sided categories and full endpoints", columns[0].value === 110 && columns.at(-1).value === 150 && columns.length === 5);
    check("waterfall missing-side adjustments reconcile endpoints", columns[0].value + columns.filter(c => c.type === "step").reduce((sum, c) => sum + c.value, 0) === columns.at(-1).value);
    check("waterfall missing-side bars are explicitly marked", columns.filter(c => c.incomplete).length === 2 && svg.textContent?.includes("*") === true);
    svg = render(data([-100, -50, 0, null], [-80, -60, 0, 1]), "variance");
    const bars = Array.from(svg.querySelectorAll(".ibcs-ac-bar"));
    const widths = bars.map(b => Number(b.getAttribute("width")));
    check("negative AC preserves 2:1 geometry", Math.abs(widths[0] / widths[1] - 2) < 0.001);
    check("missing AC has no phantom bar", widths[3] === 0);
    const zeroX = Number(svg.querySelector(".ibcs-axis-ac")?.getAttribute("x1"));
    check("negative AC bars end at the zero axis", Math.abs(Number(bars[0].getAttribute("x")) + widths[0] - zeroX) < 0.001);
    svg = render(duplicateLabelDataView(), "timeseries");
    const xs = Array.from(svg.querySelectorAll(".ibcs-series-AC rect")).map(n => n.getAttribute("x"));
    check("duplicate time-series labels occupy distinct slots", xs.length === 2 && xs[0] !== xs[1]);
    const mixed = data([100], [80]);
    mixed.categorical.values.push({ source: { displayName: "Unused rate", roles: { value: true }, format: "0.0%" }, values: [0.2] });
    const parsed = parseDataView(mixed, makeHost() as any);
    check("unused Value cannot override dedicated format", parsed?.valueFormat === "#,0" && parsed.mixedInput);
    svg = render(mixed, "variance");
    check("mixed bindings show actionable notice", document.querySelector(".ibcs-input-notice")?.textContent?.includes("Visual_MixedInput") === true);
    render(data([100], [80]), "variance");
    check("binding notice clears after correction", !document.querySelector(".ibcs-input-notice"));
    const panels = data([100, 100], [0, 90], [99, 0]);
    panels.metadata.objects = { scenarios: { comparisonMode: "all", baseScenario: "PL" }, sortSettings: { field: "delta", direction: "desc" } };
    svg = render(panels, "table");
    const orders = Array.from(svg.querySelectorAll(".ibcs-comparison-panel")).map(p => Array.from(p.querySelectorAll(".ibcs-trow")).map((r: any) => r.__data__.label).join(","));
    check("all panels follow selected primary base ordering", orders.length === 2 && orders.every(o => o === "Item 1,Item 0"));
    const rates = data([0.2, 0.3, 0.4], [0.1, 0.2, 0.3]);
    rates.categorical.values.forEach((v: any) => v.source.format = "0.0%");
    rates.metadata.objects = { chart: { showTotals: true }, topN: { mode: "items", count: 1, includeOthers: true } };
    // withMode replaces chart settings; restore showTotals explicitly below.
    const visual = makeVisual(makeHost());
    runUpdate(visual, rates);
    check("percentage auto mode suppresses totals and Others", !document.querySelector(".ibcs-total") && document.querySelectorAll(".ibcs-row").length === 1);
    svg = render(rates, "waterfall");
    check("non-additive waterfall shows explanation instead of false sum", !svg.querySelector(".ibcs-wf-column") && svg.textContent?.includes("Visual_WaterfallRequiresSum") === true);
    const distinct = data([100, 50], [90, 40]);
    distinct.metadata.objects = { chart: { aggregation: "none", showTotals: true } };
    runUpdate(makeVisual(makeHost()), distinct);
    check("explicit non-additive setting suppresses integer measure totals", !document.querySelector(".ibcs-total"));
    const dense = data(Array(36).fill(65408487), Array(36).fill(20000000));
    dense.metadata.objects = { labels: { displayUnits: "1" }, scenarios: { useDataLabels: true } };
    svg = render(dense, "timeseries", 480);
    const labels = Array.from(svg.querySelectorAll(".ibcs-ts-values text"));
    check("dense value labels are thinned", labels.length > 0 && labels.length < 36);
    check("source names are available in time-series legend", svg.textContent?.includes("Last week") === true);
    check("time-series tooltip includes calculated variance", svg.querySelector(".ibcs-series-AC rect")?.getAttribute("aria-label")?.includes("ΔLast week") === true);
}
