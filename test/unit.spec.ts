// Pure-logic unit tests (no rendering): scenario detection, DataView parsing,
// base-scenario resolution, totals aggregation and key helpers.
// Rendering behavior is covered by the smoke suite (test/smoke.ts).

import { detectScenario } from "../src/ibcs";
import { parseDataView, resolveBaseScenario } from "../src/dataModel";
import { computeTotals, totalsOpacity, dataPointKey, clamp, detectOutlierLimit, isOutlierValue } from "../src/renderers/common";
import { toNumber } from "../src/helpers";
import {
    measureModeDataView,
    dimensionModeDataView,
    duplicateLabelDataView,
    withHighlights,
    makeHost
} from "./harness";

// The mocha browser build provides BDD globals; grab loosely-typed handles.
const { describe, it, before } = globalThis as Record<string, (...args: unknown[]) => void>;

describe("scenario detection", () => {
    it("maps latin aliases", () => {
        if (detectScenario("ACTUAL") !== "AC") throw new Error("ACTUAL");
        if (detectScenario("LY") !== "PY") throw new Error("LY");
        if (detectScenario("Budget") !== "PL") throw new Error("Budget");
        if (detectScenario("FC 2026") !== "FC") throw new Error("FC 2026");
    });

    it("maps CJK aliases", () => {
        if (detectScenario("实际") !== "AC") throw new Error("实际");
        if (detectScenario("上年") !== "PY") throw new Error("上年");
        if (detectScenario("预算") !== "PL") throw new Error("预算");
        if (detectScenario("预测") !== "FC") throw new Error("预测");
    });

    it("does not false-positive on unrelated words", () => {
        if (detectScenario("SPACE") !== "UNKNOWN") throw new Error("SPACE");
        if (detectScenario(" ") !== "UNKNOWN") throw new Error("blank");
        if (detectScenario(null) !== "UNKNOWN") throw new Error("null");
    });
});

describe("resolveBaseScenario", () => {
    it("auto prefers PY, then PL, then FC", () => {
        if (resolveBaseScenario("auto", ["PL", "FC", "AC"]) !== "PL") throw new Error("PL first");
        if (resolveBaseScenario("auto", ["FC", "AC"]) !== "FC") throw new Error("FC fallback");
        if (resolveBaseScenario("auto", ["AC"]) !== null) throw new Error("no base");
    });

    it("honors an explicit choice only when present", () => {
        if (resolveBaseScenario("FC", ["PY", "FC", "AC"]) !== "FC") throw new Error("forced");
        if (resolveBaseScenario("PL", ["PY", "AC"]) !== null) throw new Error("absent");
    });
});

describe("parseDataView", () => {
    const host = makeHost();

    before(() => {
        // shared host reused across parse tests
    });

    it("pivots dedicated measure wells", () => {
        const parsed = parseDataView(measureModeDataView(), host as never);
        if (!parsed) throw new Error("null");
        if (parsed.rows.length !== 5) throw new Error("rows");
        if (parsed.rows[0].values.AC !== 36.4e9) throw new Error("AC");
        if (parsed.rows[0].values.PY !== 33.5e9) throw new Error("PY");
        if (parsed.scenarioSource !== "measures") throw new Error("source");
        if (parsed.valueFormat !== "#,0.00") throw new Error("format");
    });

    it("pivots the scenario dimension", () => {
        const parsed = parseDataView(dimensionModeDataView(), host as never);
        if (!parsed || parsed.rows.length !== 3) throw new Error("rows");
        if (parsed.rows[0].values.AC !== 36.4e9) throw new Error("AC");
        if (parsed.rows[0].values.PL !== 35e9) throw new Error("PL");
        if (parsed.scenarioSource !== "dimension") throw new Error("source");
        if (parsed.timeRows !== null) throw new Error("no timeAxis -> timeRows must be null");
    });

    it("keeps duplicate display labels as distinct identities", () => {
        const parsed = parseDataView(duplicateLabelDataView(), host as never);
        if (!parsed || parsed.rows.length !== 2) throw new Error("rows");
        if (parsed.rows[0].values.AC !== 10 || parsed.rows[0].values.PY !== 8) throw new Error("first");
        if (parsed.rows[1].values.AC !== 20 || parsed.rows[1].values.PY !== 15) throw new Error("second");
    });

    it("parses cross-visual highlight arrays", () => {
        const dv = withHighlights(measureModeDataView(), [0]);
        const parsed = parseDataView(dv, host as never);
        if (!parsed) throw new Error("null");
        if (parsed.hasHighlight !== true) throw new Error("hasHighlight");
        if (parsed.rows[0].highlighted !== true) throw new Error("row0");
        if (!parsed.rows.slice(1).every((r) => r.highlighted === false)) throw new Error("rest");
    });

    it("aggregates highlight flags across scenario leaves of the same row", () => {
        const dv = dimensionModeDataView();
        const categorical = dv.categorical as { values: Array<Record<string, unknown>> };
        // Rows are AC/PY/PL triplets; light up only the second row's PL leaf.
        categorical.values[0].highlights = (categorical.values[0].values as number[]).map((_v, i) => (i === 5 ? 1 : null));
        const parsed = parseDataView(dv, host as never);
        if (!parsed) throw new Error("null");
        if (parsed.hasHighlight !== true) throw new Error("hasHighlight");
        if (parsed.rows[0].highlighted !== false) throw new Error("row0");
        if (parsed.rows[1].highlighted !== true) throw new Error("row1");
    });
});

describe("computeTotals", () => {
    it("sums AC and base independently and derives variance", () => {
        const t = computeTotals([
            { ac: 10, base: 8 },
            { ac: 20, base: 12 },
            { ac: null, base: 5 }
        ]);
        if (t.ac !== 30) throw new Error("ac");
        if (t.base !== 25) throw new Error("base");
        if (t.delta !== 5) throw new Error("delta");
        if (Math.abs((t.deltaPct as number) - 0.2) > 1e-9) throw new Error("deltaPct");
    });

    it("returns nulls when a side is entirely missing", () => {
        const t = computeTotals([{ ac: 3, base: null }]);
        if (t.ac !== 3) throw new Error("ac");
        if (t.base !== null || t.delta !== null || t.deltaPct !== null) throw new Error("nulls");
    });

    it("yields null percent against a zero base", () => {
        const t = computeTotals([{ ac: 3, base: 0 }]);
        if (t.deltaPct !== null) throw new Error("deltaPct");
    });
});

describe("helpers", () => {
    it("toNumber accepts finite numbers only (Power BI delivers typed values)", () => {
        if (toNumber(1.5) !== 1.5) throw new Error("number");
        if (toNumber("2.5") !== null) throw new Error("string is not coerced");
        if (toNumber(NaN) !== null) throw new Error("NaN");
        if (toNumber(null) !== null) throw new Error("null");
    });

    it("clamp bounds a value", () => {
        if (clamp(5, 0, 3) !== 3) throw new Error("max");
        if (clamp(-1, 0, 3) !== 0) throw new Error("min");
        if (clamp(2, 0, 3) !== 2) throw new Error("inside");
    });

    it("dataPointKey prefers the selection id key and falls back to the label", () => {
        const withKey = { getKey: () => "k1" } as never;
        if (dataPointKey("A", withKey, 2) !== "2::k1") throw new Error("key");
        if (dataPointKey("B", undefined, 0) !== "0::B") throw new Error("label");
    });

    it("totalsOpacity dims only under an active highlight", () => {
        const ctx = { highlightActive: true } as never;
        const ctxOff = { highlightActive: false } as never;
        if (totalsOpacity(ctx, false) !== 0.35) throw new Error("dim");
        if (totalsOpacity(ctx, true) !== 1) throw new Error("lit");
        if (totalsOpacity(ctxOff, false) !== 1) throw new Error("inactive");
    });
});

describe("outlier detection", () => {
    it("engages only when the top value dominates the runner-up", () => {
        if (detectOutlierLimit([100, 30, 25, 20], true) !== 30 * 1.15) throw new Error("dominant");
        if (detectOutlierLimit([100, 90, 25, 20], true) !== Infinity) throw new Error("not dominant");
        if (detectOutlierLimit([100, 30], true) !== Infinity) throw new Error("too few rows");
        if (detectOutlierLimit([100, 30, 25], false) !== Infinity) throw new Error("disabled");
    });

    it("ignores non-positive values", () => {
        if (detectOutlierLimit([100, 0, -5, 20], true) !== Infinity) throw new Error("needs 3 positive");
    });

    it("isOutlierValue flags values above the limit only", () => {
        const limit = 34.5;
        if (!isOutlierValue(100, limit)) throw new Error("above");
        if (isOutlierValue(34.5, limit)) throw new Error("at limit");
        if (isOutlierValue(null, limit)) throw new Error("null");
    });
});
