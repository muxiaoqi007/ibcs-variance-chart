// IBCS semantic notation engine: scenario detection and notation styles.
// IBCS = International Business Communication Standards (https://www.ibcs.com)
//

import * as d3 from "d3";

// Semantic notation implemented here:
//   AC (Actual)      -> solid fill
//   PY (Prior)       -> hollow outline
//   PL (Plan/Budget) -> hatched outline
//   FC (Forecast)    -> dashed outline

export type ScenarioKind = "AC" | "PY" | "PL" | "FC" | "UNKNOWN";

/** Render order for overlays and legends: comparison scenarios first, actual last (front). */
export const SCENARIO_ORDER: ScenarioKind[] = ["PY", "PL", "FC", "AC"];

const ALIASES: Record<Exclude<ScenarioKind, "UNKNOWN">, string[]> = {
    AC: ["AC", "ACT", "ACTUAL", "ACTUALS", "IST", "实际", "実績"],
    PY: ["PY", "LY", "PRIOR", "PREVIOUS", "PREV", "VJ", "上年", "去年", "同期", "前期", "上期"],
    PL: ["PL", "PLAN", "PLN", "BUDGET", "BUD", "BU", "TARGET", "TGT", "SOLL", "计划", "预算", "目标"],
    FC: ["FC", "FORECAST", "FORE", "FCT", "PROJECTION", "PROJ", "ESTIMATE", "EST", "RE", "ROLLING", "预测", "展望"]
};

const CJK_RE = /[\u4e00-\u9fff]/;
const TOKEN_RE = /[A-Z0-9]+|[\u4e00-\u9fff]+/g;

/**
 * Detect the IBCS scenario kind from a scenario dimension value or measure name.
 * Matching is tiered: exact match, then latin token equality, then CJK substring.
 */
export function detectScenario(raw: unknown): ScenarioKind {
    if (raw === null || raw === undefined) {
        return "UNKNOWN";
    }
    const str = String(raw).trim();
    if (!str) {
        return "UNKNOWN";
    }
    const upper = str.toUpperCase();
    const compact = upper.replace(/[\s_\-.]+/g, "");
    const kinds: Array<Exclude<ScenarioKind, "UNKNOWN">> = ["AC", "PY", "PL", "FC"];

    for (const kind of kinds) {
        for (const alias of ALIASES[kind]) {
            if (CJK_RE.test(alias)) {
                continue;
            }
            const aliasCompact = alias.replace(/\s+/g, "");
            if (compact === aliasCompact) {
                return kind;
            }
        }
    }

    const tokens = upper.match(TOKEN_RE) || [];
    for (const kind of kinds) {
        for (const alias of ALIASES[kind]) {
            if (CJK_RE.test(alias)) {
                continue;
            }
            if (tokens.some((t) => t === alias)) {
                return kind;
            }
        }
    }

    for (const kind of kinds) {
        for (const alias of ALIASES[kind]) {
            if (CJK_RE.test(alias) && str.includes(alias)) {
                return kind;
            }
        }
    }

    return "UNKNOWN";
}

export interface NotationColors {
    /** Solid fill for actual values. */
    ac: string;
    /** Outline color for PY / PL / FC and neutral variance. */
    outline: string;
    /** Improvement (good) variance color. */
    positive: string;
    /** Deterioration (bad) variance color. */
    negative: string;
    /** Hairlines and secondary text. */
    grid: string;
    text: string;
}

export const DEFAULT_COLORS: NotationColors = {
    ac: "#404040",
    outline: "#7F7F7F",
    positive: "#2E9944",
    negative: "#D13438",
    grid: "#D8D8D8",
    text: "#333333"
};

export interface BarStyle {
    /** "none" = hollow, "hatch" = IBCS hatched pattern, otherwise a color. */
    fill: string;
    stroke: string | null;
    strokeWidth: number;
    dasharray: string | null;
}

export function scenarioStyle(kind: ScenarioKind, colors: NotationColors): BarStyle {
    switch (kind) {
        case "AC":
            return { fill: colors.ac, stroke: null, strokeWidth: 0, dasharray: null };
        case "PY":
            return { fill: "none", stroke: colors.outline, strokeWidth: 1.25, dasharray: null };
        case "PL":
            return { fill: "hatch", stroke: colors.outline, strokeWidth: 1.25, dasharray: null };
        case "FC":
            return { fill: "none", stroke: colors.outline, strokeWidth: 1.25, dasharray: "4,2" };
        default:
            return { fill: "#C8C8C8", stroke: null, strokeWidth: 0, dasharray: null };
    }
}

export type ColorMode = "semantic" | "neutral";
export type GoodDirection = "up" | "down";

/**
 * Resolve the color for a variance value following IBCS + good-direction logic.
 * In neutral mode variances use the actual color instead of green/red.
 */
export function varianceColor(
    delta: number,
    goodDirection: GoodDirection,
    colorMode: ColorMode,
    colors: NotationColors
): string {
    if (colorMode === "neutral") {
        return colors.ac;
    }
    if (delta === 0) {
        return colors.outline;
    }
    const improving = goodDirection === "up" ? delta > 0 : delta < 0;

    return improving ? colors.positive : colors.negative;
}

export const HATCH_PATTERN_ID = "ibcs-hatch";

/**
 * Ensure the IBCS hatch pattern (used for plan/budget) exists in the svg defs.
 */
export function ensureHatchPattern(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, color: string): void {
    let defs = svg.select<SVGDefsElement>("defs");
    if (defs.empty()) {
        defs = svg.append("defs");
    }
    const pattern = defs.selectAll<SVGPatternElement, number>(`pattern#${HATCH_PATTERN_ID}`).data([0]);
    const entered = pattern
        .enter()
        .append("pattern")
        .attr("id", HATCH_PATTERN_ID)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("width", 6)
        .attr("height", 6)
        .attr("patternTransform", "rotate(45)");
    entered.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke-width", 1.6);
    defs.selectAll(`pattern#${HATCH_PATTERN_ID} line`).attr("stroke", color);
}

/** Apply an IBCS bar style to a d3 selection of rects/paths. */
export function applyBarStyle(
    sel: d3.Selection<SVGRectElement, unknown, null, undefined>,
    style: BarStyle
): void {
    sel
        .attr("fill", style.fill === "hatch" ? `url(#${HATCH_PATTERN_ID})` : style.fill)
        .attr("stroke", style.stroke)
        .attr("stroke-width", style.strokeWidth)
        .attr("stroke-dasharray", style.dasharray);
}
