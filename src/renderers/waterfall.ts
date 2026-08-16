// IBCS waterfall chart.
// With a base scenario: base total -> per-category variances -> actual total.
// Without a base scenario: actual values as steps with a trailing total.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, scenarioStyle, applyBarStyle, varianceColor, ensureHatchPattern } from "../ibcs";
import { formatSigned, measureText, truncateText } from "../helpers";
import { RenderContext, bindInteractions, selectionOpacity, TooltipItem } from "./common";

const MIN_POINTER_TARGET = 24;

export type WaterfallColumnType = "start" | "step" | "end";

export interface WaterfallColumn {
    type: WaterfallColumnType;
    label: string;
    /** Increment for steps; absolute level for start/end. */
    value: number;
    /** Running levels computed by the renderer. */
    from?: number;
    to?: number;
    selectionId: powerbi.visuals.ISelectionId;
    selectionIds?: powerbi.visuals.ISelectionId[];
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

    const columns = model.columns;
    if (columns.length === 0) {
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
    const xLabelH = fontSize + 16;
    const plotH = Math.max(0, height - topPad - xLabelH);
    const plotW = width - 8;

    const lows = columns.map((c) => Math.min(c.from ?? 0, c.to ?? 0));
    const highs = columns.map((c) => Math.max(c.from ?? 0, c.to ?? 0));
    const lo = Math.min(0, d3.min(lows) ?? 0);
    const hi = d3.max(highs) ?? 0;
    if (hi <= lo) {
        return;
    }

    const x = d3.scaleBand<number>().domain(d3.range(columns.length)).range([4, 4 + plotW]).paddingInner(0.3).paddingOuter(0.15);
    const y = d3.scaleLinear().domain([lo, hi * 1.08]).range([topPad + plotH, topPad]);
    const zeroY = y(0);

    svg.append("line")
        .attr("x1", 4)
        .attr("x2", 4 + plotW)
        .attr("y1", zeroY)
        .attr("y2", zeroY)
        .attr("stroke", colors.outline)
        .attr("stroke-width", 0.75);

    const bw = x.bandwidth();

    columns.forEach((col, i) => {
        const xPos = (x(i) ?? 0);
        const top = y(Math.max(col.from ?? 0, col.to ?? 0));
        const bottom = y(Math.min(col.from ?? 0, col.to ?? 0));
        const h = Math.max(1, bottom - top);

        let fill = colors.ac;
        let style = scenarioStyle("AC", colors);
        if (col.type === "start" && model.baseKind) {
            style = scenarioStyle(model.baseKind, colors);
        } else if (col.type === "step") {
            fill = varianceColor(col.value, goodDirection, colorMode, colors);
            style = { fill, stroke: null, strokeWidth: 0, dasharray: null };
        }

        const rect = svg
            .append("rect")
            .attr("class", "ibcs-wf-bar")
            .attr("x", xPos)
            .attr("y", top)
            .attr("width", bw)
            .attr("height", h)
            .attr("opacity", selectionOpacity(ctx, col.selectionId));
        applyBarStyle(rect as d3.Selection<SVGRectElement, unknown, null, undefined>, style);

        const items = (): TooltipItem[] => {
            const list: TooltipItem[] = [{
                displayName: ctx.localization.getDisplayName("Visual_Tooltip_Category") || "Category",
                value: col.label
            }];
            if (col.type === "step") {
                list.push({ displayName: `\u0394`, value: formatSigned(formatter, col.value) });
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
        const hitRect = svg
            .append("rect")
            .attr("class", "ibcs-wf-hit")
            .attr("x", xPos)
            .attr("y", hitY)
            .attr("width", bw)
            .attr("height", hitHeight)
            .attr("fill", "transparent")
            .attr("pointer-events", "all");
        bindInteractions(ctx, hitRect, () => col.selectionIds ?? col.selectionId, items);

        if (showLabels) {
            const isNeg = col.type === "step" && col.value < 0;
            svg.append("text")
                .attr("x", xPos + bw / 2)
                .attr("y", isNeg ? bottom + fontSize : top - 3)
                .attr("text-anchor", "middle")
                .attr("font-size", fontSize - 1)
                .attr("fill", col.type === "step" ? varianceColor(col.value, goodDirection, colorMode, colors) : colors.text)
                .attr("pointer-events", "none")
                .text(col.type === "step" ? formatSigned(formatter, col.value) : formatter(col.value));
        }

        // connector to next column
        if (i < columns.length - 1 && columns[i + 1].type === "step") {
            svg.append("line")
                .attr("x1", xPos + bw)
                .attr("x2", (x(i + 1) ?? 0))
                .attr("y1", y(col.to ?? 0))
                .attr("y2", y(col.to ?? 0))
                .attr("stroke", colors.outline)
                .attr("stroke-width", 0.75)
                .attr("pointer-events", "none");
        }
    });

    // x labels with rotation when crowded
    const maxLabelW = d3.max(columns, (c) => measureText(c.label, fontSize - 1)) ?? 0;
    const crowded = maxLabelW > bw + 6;
    svg.append("g")
        .selectAll("text")
        .data(columns)
        .enter()
        .append("text")
        .attr("transform", (c, i) => {
            const xPos = (x(i) ?? 0) + bw / 2;
            const yPos = topPad + plotH + fontSize + 2;

            return crowded ? `translate(${xPos}, ${yPos}) rotate(-45)` : `translate(${xPos}, ${yPos})`;
        })
        .attr("text-anchor", crowded ? "end" : "middle")
        .attr("font-size", fontSize - 1)
        .attr("fill", colors.text)
        .attr("pointer-events", "none")
        .text((c) => (crowded ? truncateText(c.label, 90, fontSize - 1) : truncateText(c.label, bw + 14, fontSize - 1)));
}
