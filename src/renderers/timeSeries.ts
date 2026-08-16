// IBCS semantic time series: overlaid scenario columns per time point.
// PY/PL/FC drawn as hollow/hatched/dashed outlines behind, AC as solid in front.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, SCENARIO_ORDER, scenarioStyle, applyBarStyle, ensureHatchPattern } from "../ibcs";
import { measureText } from "../helpers";
import { RenderContext, bindInteractions, selectionOpacity, TooltipItem } from "./common";

export interface TimeSeriesModel {
    points: Array<{
        label: string;
        selectionId: powerbi.visuals.ISelectionId;
        values: Partial<Record<ScenarioKind, number>>;
        tooltipExtra: TooltipItem[];
    }>;
    present: ScenarioKind[];
    scenarioDisplay: Partial<Record<ScenarioKind, string>>;
}

export function renderTimeSeries(ctx: RenderContext, model: TimeSeriesModel): void {
    const { svg, width, height, colors, settings, formatter, fontSize } = ctx;
    ensureHatchPattern(svg, colors.outline);

    const points = model.points;
    if (points.length === 0) {
        return;
    }
    const showLabels = settings.labels?.showValueLabels?.value !== false;
    const legendH = fontSize + 10;
    const xLabelH = fontSize + 12;
    const topPad = showLabels ? fontSize + 6 : 6;
    const plotW = width - 8;
    const plotH = Math.max(0, height - legendH - xLabelH - topPad);

    const allValues = points.flatMap((p) => Object.values(p.values).filter((v): v is number => v !== undefined && isFinite(v)));
    const maxVal = d3.max(allValues) ?? 0;
    const minVal = Math.min(0, d3.min(allValues) ?? 0);
    if (maxVal <= minVal) {
        return;
    }

    const x = d3.scaleBand<string>().domain(points.map((p) => p.label)).range([4, 4 + plotW]).paddingInner(0.28).paddingOuter(0.12);
    const y = d3.scaleLinear().domain([minVal, maxVal * 1.1]).range([topPad + plotH, topPad]);
    const zeroY = y(Math.max(0, minVal));

    // baseline
    svg.append("line")
        .attr("x1", 4)
        .attr("x2", 4 + plotW)
        .attr("y1", zeroY)
        .attr("y2", zeroY)
        .attr("stroke", colors.outline)
        .attr("stroke-width", 0.75);

    const bw = x.bandwidth();
    const overlayOrder = SCENARIO_ORDER.filter((k) => model.present.includes(k));
    const scenarioLabel = (k: ScenarioKind): string => model.scenarioDisplay[k] ?? k;

    const tooltipFor = (p: TimeSeriesModel["points"][number]): TooltipItem[] => {
        const items: TooltipItem[] = [];
        for (const kind of overlayOrder) {
            const v = p.values[kind];
            if (v !== undefined) {
                items.push({ displayName: kind === "AC" ? "AC" : scenarioLabel(kind), value: formatter(v) });
            }
        }

        return items.concat(p.tooltipExtra);
    };

    // Overlay draw order: comparison scenarios first (back), AC last (front).
    for (const kind of overlayOrder) {
        const style = scenarioStyle(kind, colors);
        const isAc = kind === "AC";
        const barW = isAc ? bw * 0.62 : bw * 0.92;

        const bars = svg
            .append("g")
            .attr("class", `ibcs-series-${kind}`)
            .selectAll("rect")
            .data(points.filter((p) => p.values[kind] !== undefined))
            .enter()
            .append("rect")
            .attr("x", (p) => (x(p.label) ?? 0) + (bw - barW) / 2)
            .attr("y", (p) => {
                const v = p.values[kind] as number;

                return v >= 0 ? y(v) : zeroY;
            })
            .attr("width", barW)
            .attr("height", (p) => Math.max(1, Math.abs(y(p.values[kind] as number) - zeroY)))
            .attr("opacity", (p) => selectionOpacity(ctx, p.selectionId));
        applyBarStyle(bars as d3.Selection<SVGRectElement, unknown, null, undefined>, style);
        bars.each(function (p) {
            bindInteractions(ctx, d3.select(this), () => p.selectionId, () => tooltipFor(p));
        });

        if (showLabels && isAc) {
            svg.append("g")
                .selectAll("text")
                .data(points.filter((p) => p.values.AC !== undefined))
                .enter()
                .append("text")
                .attr("x", (p) => (x(p.label) ?? 0) + bw / 2)
                .attr("y", (p) => y(p.values.AC as number) - 3)
                .attr("text-anchor", "middle")
                .attr("font-size", fontSize - 1)
                .attr("fill", colors.text)
                .text((p) => formatter(p.values.AC as number));
        }
    }

    // --- x axis labels (skip crowded) ---
    const maxLabelW = d3.max(points, (p) => measureText(p.label, fontSize - 1)) ?? 0;
    const step = Math.max(1, Math.ceil(maxLabelW / (bw + bw * 0.28)));
    svg.append("g")
        .selectAll("text")
        .data(points.filter((_p, i) => i % step === 0))
        .enter()
        .append("text")
        .attr("x", (p) => (x(p.label) ?? 0) + bw / 2)
        .attr("y", topPad + plotH + fontSize + 2)
        .attr("text-anchor", "middle")
        .attr("font-size", fontSize - 1)
        .attr("fill", colors.text)
        .text((p) => p.label);

    // --- semantic legend ---
    const legendY = height - legendH + fontSize / 2;
    let cursor = 4;
    for (const kind of overlayOrder) {
        const style = scenarioStyle(kind, colors);
        const g = svg.append("g").attr("transform", `translate(${cursor}, ${legendY})`);
        const glyph = g.append("rect").attr("x", 0).attr("y", -5).attr("width", 10).attr("height", 10);
        applyBarStyle(glyph as d3.Selection<SVGRectElement, unknown, null, undefined>, style);
        const text = kind === "AC" ? "AC" : scenarioLabel(kind);
        g.append("text")
            .attr("x", 14)
            .attr("y", 0)
            .attr("dy", "0.35em")
            .attr("font-size", fontSize - 1)
            .attr("fill", colors.text)
            .text(text);
        cursor += 14 + measureText(text, fontSize - 1) + 16;
        if (cursor > width - 20) {
            break;
        }
    }
}
