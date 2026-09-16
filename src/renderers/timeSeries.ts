// IBCS semantic time series: overlaid scenario columns per time point.
// PY/PL/FC drawn as hollow/hatched/dashed outlines behind, AC as solid in front.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, SCENARIO_ORDER, scenarioStyle, applyBarStyle, ensureHatchPattern } from "../ibcs";
import { measureText, truncateText, formatSigned, formatSignedPercent } from "../helpers";
import { resolveBaseScenario } from "../dataModel";
import { RenderContext, bindInteractions, dataPointOpacity, TooltipItem, scenarioLabel } from "./common";

export interface TimeSeriesModel {
    points: Array<{
        label: string;
        selectionId: powerbi.visuals.ISelectionId;
        values: Partial<Record<ScenarioKind, number>>;
        /** Cross-visual highlight state for this time point. */
        highlighted: boolean;
        tooltipExtra: TooltipItem[];
    }>;
    present: ScenarioKind[];
    scenarioDisplay: Partial<Record<ScenarioKind, string>>;
}

export function renderTimeSeries(ctx: RenderContext, model: TimeSeriesModel): void {
    const { svg, width, height, colors, settings, formatter, fontSize } = ctx;
    ensureHatchPattern(svg, colors.outline);

    // Persistent container: rebuilt per update but keeps the svg (defs,
    // sibling structure) intact so cross-updates stay cheap.
    let chart = svg.select<SVGGElement>("g.ibcs-ts-chart");
    if (chart.empty()) {
        chart = svg.append("g").attr("class", "ibcs-ts-chart");
    }
    chart.selectAll("*").remove();

    const points = model.points.map((point, slot) => ({ ...point, slot }));
    if (points.length === 0) {
        return;
    }
    const showLabels = settings.labels?.showValueLabels?.value !== false;
    const legendH = fontSize + 10;
    const xLabelH = fontSize + 12;
    const topPad = showLabels ? fontSize + 6 : 6;
    const plotW = Math.max(0, width - 8);
    const plotH = Math.max(0, height - legendH - xLabelH - topPad);

    const allValues = points.flatMap((p) => Object.values(p.values).filter((v): v is number => v !== undefined && isFinite(v)));
    const rawMax = d3.max(allValues) ?? 0;
    const rawMin = d3.min(allValues) ?? 0;
    const sameValue = rawMax === rawMin;
    const pad = Math.max(1, Math.abs(rawMax || rawMin) * 0.1);
    // Preserve a zero baseline for bar geometry while padding degenerate
    // domains so all-zero/all-single-value series remain visible.
    const minVal = sameValue ? Math.min(0, rawMin - pad) : Math.min(0, rawMin);
    const maxVal = sameValue ? Math.max(0, rawMax + pad) : Math.max(0, rawMax);
    const domainMax = maxVal > 0 ? maxVal * 1.1 : maxVal;

    const x = d3.scaleBand<number>().domain(points.map((p) => p.slot)).range([4, 4 + plotW]).paddingInner(0.28).paddingOuter(0.12);
    const y = d3.scaleLinear().domain([minVal, domainMax]).range([topPad + plotH, topPad]);
    const zeroY = y(Math.max(0, minVal));

    // baseline
    chart.append("line")
        .attr("x1", 4)
        .attr("x2", 4 + plotW)
        .attr("y1", zeroY)
        .attr("y2", zeroY)
        .attr("stroke", colors.outline)
        .attr("stroke-width", 0.75);

    const bw = x.bandwidth();
    const overlayOrder = SCENARIO_ORDER.filter((k) => model.present.includes(k));

    const tooltipFor = (p: TimeSeriesModel["points"][number]): TooltipItem[] => {
        const items: TooltipItem[] = [{
            displayName: ctx.localization.getDisplayName("Visual_Tooltip_Category") || "Category",
            value: p.label
        }];
        for (const kind of overlayOrder) {
            const v = p.values[kind];
            if (v !== undefined) {
                items.push({ displayName: scenarioLabel(ctx, kind), value: formatter(v) });
            }
        }
        const baseKind = resolveBaseScenario(String(settings.scenarios.baseScenario.value), model.present);
        const base = baseKind ? p.values[baseKind] : undefined;
        if (base !== undefined && p.values.AC !== undefined) {
            const delta = p.values.AC - base;
            if (settings.variance.showDeltaAbs.value) {
                items.push({ displayName: `Δ${scenarioLabel(ctx, baseKind)}`, value: formatSigned(formatter, delta) });
            }
            if (settings.variance.showDeltaPct.value && base !== 0) {
                items.push({ displayName: `Δ${scenarioLabel(ctx, baseKind)}%`, value: formatSignedPercent(delta / base) });
            }
        }

        return items.concat(p.tooltipExtra);
    };

    // Overlay draw order: comparison scenarios first (back), AC last (front).
    for (const kind of overlayOrder) {
        const style = scenarioStyle(kind, colors);
        const isAc = kind === "AC";
        const barW = isAc ? bw * 0.62 : bw * 0.92;

        const bars = chart
            .append("g")
            .attr("class", `ibcs-series-${kind}`)
            .selectAll("rect")
            .data(points.filter((p) => p.values[kind] !== undefined))
            .enter()
            .append("rect")
            .attr("x", (p) => (x(p.slot) ?? 0) + (bw - barW) / 2)
            .attr("y", (p) => {
                const v = p.values[kind] as number;

                return v >= 0 ? y(v) : zeroY;
            })
            .attr("width", barW)
            .attr("height", (p) => Math.max(1, Math.abs(y(p.values[kind] as number) - zeroY)))
            .attr("opacity", (p) => dataPointOpacity(ctx, p.selectionId, p.highlighted));
        applyBarStyle(bars as d3.Selection<SVGRectElement, unknown, null, undefined>, style);
        bars.each(function (p) {
            bindInteractions(ctx, d3.select(this), () => p.selectionId, () => tooltipFor(p));
        });

        if (showLabels && isAc) {
            let previousRight = -Infinity;
            const labeled = points.filter((p) => {
                if (p.values.AC === undefined) return false;
                const labelW = measureText(formatter(p.values.AC), fontSize - 1);
                const center = (x(p.slot) ?? 0) + bw / 2;
                const left = center - labelW / 2;
                const right = center + labelW / 2;
                if (left < 0 || right > width || left < previousRight + 6) return false;
                previousRight = right;
                return true;
            });
            chart.append("g")
                .attr("class", "ibcs-ts-values")
                .selectAll("text")
                .data(labeled)
                .enter()
                .append("text")
                .attr("x", (p) => (x(p.slot) ?? 0) + bw / 2)
                .attr("y", (p) => Math.min(topPad + plotH - 2, y(p.values.AC as number) + ((p.values.AC as number) < 0 ? fontSize : -3)))
                .attr("text-anchor", "middle")
                .attr("font-size", fontSize - 1)
                .attr("fill", colors.text)
                .attr("opacity", (p) => dataPointOpacity(ctx, p.selectionId, p.highlighted))
                .text((p) => formatter(p.values.AC as number));
        }
    }

    // --- x axis labels (skip crowded) ---
    const maxLabelW = d3.max(points, (p) => measureText(p.label, fontSize - 1)) ?? 0;
    const step = Math.max(1, Math.ceil((maxLabelW + 6) / Math.max(1, x.step())));
    chart.append("g")
        .selectAll("text")
        .data(points.filter((_p, i) => i % step === 0))
        .enter()
        .append("text")
        .attr("x", (p) => (x(p.slot) ?? 0) + bw / 2)
        .attr("y", topPad + plotH + fontSize + 2)
        .attr("text-anchor", "middle")
        .attr("font-size", fontSize - 1)
        .attr("fill", colors.text)
        .text((p) => truncateText(p.label, Math.max(0, Math.min(width - 8, x.step() * step - 6)), fontSize - 1));

    // --- semantic legend ---
    const legendY = height - legendH + fontSize / 2;
    let cursor = 4;
    const legendSlot = Math.max(0, (width - 8) / overlayOrder.length);
    for (const kind of overlayOrder) {
        const style = scenarioStyle(kind, colors);
        const g = chart.append("g").attr("transform", `translate(${cursor}, ${legendY})`);
        const glyph = g.append("rect").attr("x", 0).attr("y", -5).attr("width", 10).attr("height", 10);
        applyBarStyle(glyph as d3.Selection<SVGRectElement, unknown, null, undefined>, style);
        const text = scenarioLabel(ctx, kind);
        g.append("text")
            .attr("x", 14)
            .attr("y", 0)
            .attr("dy", "0.35em")
            .attr("font-size", fontSize - 1)
            .attr("fill", colors.text)
            .text(truncateText(text, Math.max(0, legendSlot - 24), fontSize - 1));
        g.append("title").text(text);
        cursor += legendSlot;
    }
}
