// IBCS waterfall chart.
// With a base scenario: base total -> per-category variances -> actual total.
// Without a base scenario: actual values as steps with a trailing total.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, scenarioStyle, applyBarStyle, varianceColor, ensureHatchPattern } from "../ibcs";
import { formatSigned, truncateText } from "../helpers";
import { RenderContext, bindInteractions, dataPointOpacity, TooltipItem } from "./common";

const MIN_POINTER_TARGET = 24;

export type WaterfallColumnType = "start" | "step" | "end";

export interface WaterfallColumn {
    type: WaterfallColumnType;
    label: string;
    /** Increment for steps; absolute level for start/end. */
    value: number;
    incomplete?: boolean;
    /** Running levels computed by the renderer. */
    from?: number;
    to?: number;
    selectionId: powerbi.visuals.ISelectionId;
    selectionIds?: powerbi.visuals.ISelectionId[];
    /** Cross-visual highlight state (aggregated over the source rows). */
    highlighted: boolean;
    tooltipExtra: TooltipItem[];
}

export interface WaterfallModel {
    columns: WaterfallColumn[];
    baseKind: ScenarioKind | null;
    totalLabel: string;
}

export function renderWaterfall(ctx: RenderContext, model: WaterfallModel): void {
    const { svg, width, height, colors, settings, formatter, fontSize } = ctx;
    ensureHatchPattern(svg, colors.outline);

    // Keep keyed columns and their interaction targets stable across updates.
    let chart = svg.select<SVGGElement>("g.ibcs-wf-chart");
    if (chart.empty()) {
        chart = svg.append("g").attr("class", "ibcs-wf-chart");
    }


    const columns = model.columns;
    if (columns.length === 0) {
        chart.selectAll("*").remove();
        return;
    }
    const colorMode = settings.variance.colorMode.value as "semantic" | "neutral";
    const goodDirection = settings.variance.goodDirection.value as "up" | "down";
    const showLabels = settings.labels?.showValueLabels?.value !== false;

    // running levels
    let running = 0;
    columns.forEach((col) => {
        if (col.type === "start") {
            col.from = 0;
            col.to = col.value;
            running = col.value;
        } else if (col.type === "step") {
            col.from = running;
            col.to = running + col.value;
            running = col.to as number;
        } else {
            // end column: explicit level when a base exists, otherwise accumulated total
            col.from = 0;
            col.to = col.value;
        }
    });

    const topPad = showLabels ? fontSize + 8 : 8;
    // Horizontal, width-bounded labels remain inside compact viewports.
    const hasMissing = columns.some((col) => col.incomplete);
    const xLabelH = fontSize + 16 + (hasMissing ? fontSize + 8 : 0);
    chart.selectAll<SVGTextElement, string>("text.ibcs-wf-missing-note")
        .data(hasMissing ? [`* ${ctx.localization.getDisplayName("Visual_MissingComparisonDetail")}`] : [])
        .join("text").attr("class", "ibcs-wf-missing-note")
        .attr("x", 4).attr("y", height - 4).attr("font-size", fontSize - 1).attr("fill", colors.text)
        .text((text) => truncateText(text, Math.max(0, width - 8), fontSize - 1))
        .selectAll("title").data((text) => [text]).join("title").text((text) => text);
    const plotH = Math.max(0, height - topPad - xLabelH);
    const plotW = Math.max(0, width - 8);

    const lows = columns.map((c) => Math.min(c.from ?? 0, c.to ?? 0));
    const highs = columns.map((c) => Math.max(c.from ?? 0, c.to ?? 0));
    const lo = Math.min(0, d3.min(lows) ?? 0);
    const rawHi = d3.max(highs) ?? 0;
    const hi = Math.max(0, rawHi);
    const equalRange = hi <= lo;
    const rangePad = Math.max(1, Math.abs(hi || lo) * 0.1);
    const domainLo = equalRange ? lo - rangePad : lo;
    const domainHi = equalRange ? hi + rangePad : hi * 1.08;

    const x = d3.scaleBand<number>().domain(d3.range(columns.length)).range([4, 4 + plotW]).paddingInner(0.3).paddingOuter(0.15);
    const y = d3.scaleLinear().domain([domainLo, domainHi]).range([topPad + plotH, topPad]);
    const zeroY = y(0);

    chart.selectAll<SVGLineElement, number>("line.ibcs-wf-zero").data([0]).join("line")
        .attr("class", "ibcs-wf-zero")
        .attr("x1", 4)
        .attr("x2", 4 + plotW)
        .attr("y1", zeroY)
        .attr("y2", zeroY)
        .attr("stroke", colors.outline)
        .attr("stroke-width", 0.75);

    const bw = x.bandwidth();

    const groups = chart.selectAll<SVGGElement, WaterfallColumn>("g.ibcs-wf-column")
        .data(columns, (col) => `${col.type}:${col.selectionId?.getKey() ?? col.label}`)
        .join("g")
        .attr("class", "ibcs-wf-column")
        .order();
    groups.each(function(col, i) {
        const group = d3.select(this);
        const xPos = (x(i) ?? 0);
        const top = y(Math.max(col.from ?? 0, col.to ?? 0));
        const bottom = y(Math.min(col.from ?? 0, col.to ?? 0));
        const h = Math.max(1, bottom - top);

        let fill = colors.ac;
        let style = scenarioStyle("AC", colors);
        if (col.type === "start" && model.baseKind) {
            style = scenarioStyle(model.baseKind, colors);
        } else if (col.type === "step") {
            fill = col.incomplete ? colors.outline : varianceColor(col.value, goodDirection, colorMode, colors);
            style = { fill, stroke: null, strokeWidth: 0, dasharray: null };
        }

        const rect = group.selectAll<SVGRectElement, WaterfallColumn>("rect.ibcs-wf-bar")
            .data([col]).join("rect")
            .attr("class", "ibcs-wf-bar")
            .attr("x", xPos)
            .attr("y", top)
            .attr("width", bw)
            .attr("height", h)
            .attr("opacity", dataPointOpacity(ctx, col.selectionId, col.highlighted));
        applyBarStyle(rect as d3.Selection<SVGRectElement, unknown, null, undefined>, style);

        const items = (): TooltipItem[] => {
            const list: TooltipItem[] = [{
                displayName: ctx.localization.getDisplayName("Visual_Tooltip_Category") || "Category",
                value: col.label
            }];
            if (col.type === "step") {
                list.push({ displayName: col.incomplete ? ctx.localization.getDisplayName("Visual_MissingComparison") : `\u0394`, value: formatSigned(formatter, col.value) });
            } else {
                list.push({ displayName: col.label, value: formatter(col.value) });
            }

            return list.concat(col.tooltipExtra);
        };

        // Preserve the truthful bar height while providing a usable pointer
        // target for very small variances. Twenty-four pixels follows the
        // minimum target size used by compact desktop controls.
        const hitHeight = Math.min(plotH, Math.max(MIN_POINTER_TARGET, h));
        const hitCenter = (top + bottom) / 2;
        const hitY = Math.max(topPad, Math.min(hitCenter - hitHeight / 2, topPad + plotH - hitHeight));
        const hitRect = group.selectAll<SVGRectElement, WaterfallColumn>("rect.ibcs-wf-hit")
            .data([col]).join("rect")
            .attr("class", "ibcs-wf-hit")
            .attr("x", xPos)
            .attr("y", hitY)
            .attr("width", bw)
            .attr("height", hitHeight)
            .attr("fill", "transparent")
            .attr("pointer-events", "all");
        bindInteractions(ctx, hitRect, () => col.selectionIds ?? col.selectionId, items);

        const isNeg = col.type === "step" && col.value < 0;
        group.selectAll<SVGTextElement, WaterfallColumn>("text.ibcs-wf-value")
                .data(showLabels ? [col] : []).join("text")
                .attr("class", "ibcs-wf-value")
                .attr("x", xPos + bw / 2)
                .attr("y", Math.min(topPad + plotH - 2, isNeg ? bottom + fontSize : top - 3))
                .attr("text-anchor", "middle")
                .attr("font-size", fontSize - 1)
                .attr("fill", col.type === "step" && !col.incomplete ? varianceColor(col.value, goodDirection, colorMode, colors) : colors.text)
                .attr("opacity", dataPointOpacity(ctx, col.selectionId, col.highlighted))
                .attr("pointer-events", "none")
                .text(truncateText(col.type === "step" ? formatSigned(formatter, col.value) : formatter(col.value), x.step() - 4, fontSize - 1));

        // connector to next column
        group.selectAll<SVGLineElement, WaterfallColumn>("line.ibcs-wf-connector")
                .data(i < columns.length - 1 && columns[i + 1].type === "step" ? [col] : []).join("line")
                .attr("class", "ibcs-wf-connector")
                .attr("x1", xPos + bw)
                .attr("x2", (x(i + 1) ?? 0))
                .attr("y1", y(col.to ?? 0))
                .attr("y2", y(col.to ?? 0))
                .attr("stroke", colors.outline)
                .attr("stroke-width", 0.75)
                .attr("pointer-events", "none");

        group.selectAll<SVGTextElement, WaterfallColumn>("text.ibcs-wf-category")
        .data([col]).join("text")
        .attr("class", "ibcs-wf-category")
        .attr("x", xPos + bw / 2)
        .attr("y", topPad + plotH + fontSize + 2)
        .attr("text-anchor", "middle")
        .attr("font-size", fontSize - 1)
        .attr("fill", colors.text)
        .attr("pointer-events", "none")
        .text((col) => truncateText(col.label, x.step() - 4, fontSize - 1));
    });
}
