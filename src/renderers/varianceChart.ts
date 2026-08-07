// Variance composite chart (Zebra BI style):
// rows = categories, columns = AC bar | absolute variance bars | percent variance markers.
//
// Design notes (IBCS / Zebra BI):
// - AC: solid horizontal bars, value label right of the bar (inside when space is tight)
// - ΔPY: vertical variance bars on a shared zero baseline per row band
// - ΔPY%: lollipop markers on a shared scale, values right-aligned at the column edge
// - single zero axis line per variance column, hairline row separators

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, varianceColor, ensureHatchPattern } from "../ibcs";
import { formatSigned, formatSignedPercent, measureText, truncateText } from "../helpers";
import { RenderContext, bindInteractions, selectionOpacity, TooltipItem, clamp, cycleSort, sortArrow, SortField } from "./common";

export interface VarianceRow {
    label: string;
    selectionId: powerbi.visuals.ISelectionId;
    ac: number | null;
    base: number | null;
    delta: number | null;
    deltaPct: number | null;
    tooltipExtra: TooltipItem[];
}

export interface VarianceModel {
    rows: VarianceRow[];
    baseKind: ScenarioKind | null;
    baseLabel: string;
}

export function renderVarianceChart(ctx: RenderContext, model: VarianceModel): void {
    const { svg, width, height, colors, settings, formatter, fontSize } = ctx;
    ensureHatchPattern(svg, colors.outline);

    const rows = model.rows;
    const baseKind = model.baseKind;
    const showAbs = settings.variance.showDeltaAbs.value && baseKind !== null;
    const showPct = settings.variance.showDeltaPct.value && baseKind !== null;
    const colorMode = settings.variance.colorMode.value as "semantic" | "neutral";
    const goodDirection = settings.variance.goodDirection.value as "up" | "down";
    const showLabels = settings.labels.showValueLabels.value;

    const headerH = fontSize + 12;
    const bottomPad = 4;
    const rowArea = Math.max(0, height - headerH - bottomPad);
    const rowH = rows.length > 0 ? clamp(rowArea / rows.length, 16, 44) : 0;

    // --- label column ---
    const configuredLabelW = settings.notation.labelWidth.value;
    const maxLabelPx = d3.max(rows, (r) => measureText(r.label, fontSize)) ?? 0;
    const labelW = configuredLabelW > 0
        ? Math.min(configuredLabelW, width * 0.6)
        : clamp(maxLabelPx + 20, 64, width * 0.36);

    const gap = 14;
    const plotW = Math.max(0, width - labelW - gap);
    let wAc = plotW;
    let wAbs = 0;
    let wPct = 0;
    if (showAbs && showPct) {
        wAc = plotW * 0.42;
        wAbs = plotW * 0.30;
        wPct = plotW * 0.28;
    } else if (showAbs || showPct) {
        wAc = plotW * 0.58;
        if (showAbs) {
            wAbs = plotW * 0.42;
        } else {
            wPct = plotW * 0.42;
        }
    }

    const xAc = labelW + gap;
    const xAbs = xAc + wAc;
    const xPct = xAbs + wAbs;

    // --- scales ---
    const maxAc = d3.max(rows, (r) => (r.ac !== null && r.ac > 0 ? r.ac : 0)) ?? 0;
    const deltas = rows.map((r) => r.delta).filter((d): d is number => d !== null);
    const maxPos = d3.max(deltas.filter((d) => d > 0)) ?? 0;
    const maxNeg = d3.max(deltas.filter((d) => d < 0).map((d) => -d)) ?? 0;
    const pcts = rows.map((r) => r.deltaPct).filter((d): d is number => d !== null);
    const maxPctAbs = d3.max(pcts.map((p) => Math.abs(p))) ?? 0;
    const hasNegPct = pcts.some((p) => p < 0);

    const acRange = wAc * 0.72; // reserve room for outside labels
    const acScale = maxAc > 0 ? acRange / maxAc : 0;

    // --- header (IBCS abbreviations, clickable for Zebra-style sorting) ---
    const sortField = String(settings.sortSettings.field.value ?? "none");
    let acAutoArrow = "";
    if (sortField === "none") {
        const acValues = rows.map((r) => r.ac).filter((v): v is number => v !== null);
        if (acValues.length > 1) {
            let desc = true;
            let asc = true;
            for (let i = 1; i < acValues.length; i++) {
                if (acValues[i] > acValues[i - 1]) {
                    desc = false;
                }
                if (acValues[i] < acValues[i - 1]) {
                    asc = false;
                }
            }
            acAutoArrow = desc ? " \u2193" : asc ? " \u2191" : "";
        }
    }
    const headerItems: Array<{ x: number; text: string; sort: SortField }> = [
        { x: xAc, text: `AC${sortField === "ac" ? sortArrow(ctx, "ac") : acAutoArrow}`, sort: "ac" }
    ];
    if (showAbs) {
        headerItems.push({ x: xAbs, text: `\u0394${baseKind}${sortArrow(ctx, "delta")}`, sort: "delta" });
    }
    if (showPct) {
        headerItems.push({ x: xPct, text: `\u0394${baseKind}%${sortArrow(ctx, "deltaPct")}`, sort: "deltaPct" });
    }
    svg.append("g")
        .attr("class", "ibcs-header")
        .selectAll("text")
        .data(headerItems)
        .enter()
        .append("text")
        .attr("x", (d) => d.x)
        .attr("y", headerH - 7)
        .attr("font-size", fontSize - 1)
        .attr("font-weight", 600)
        .attr("fill", "#767676")
        .style("cursor", "pointer")
        .text((d) => d.text)
        .on("click", (event: MouseEvent, d) => {
            event.stopPropagation();
            cycleSort(ctx, d.sort);
        });

    const body = svg.append("g").attr("class", "ibcs-body").attr("transform", `translate(0, ${headerH})`);

    const rowSel = body
        .selectAll("g.ibcs-row")
        .data(rows)
        .enter()
        .append("g")
        .attr("class", "ibcs-row")
        .attr("transform", (_d, i) => `translate(0, ${i * rowH})`);

    // hairline separators
    rowSel
        .filter((_d, i) => i > 0)
        .append("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", 0)
        .attr("y2", 0)
        .attr("stroke", "#ECECEC")
        .attr("stroke-width", 1);

    // category labels (right aligned, IBCS table convention)
    rowSel
        .append("text")
        .attr("x", labelW - 10)
        .attr("y", rowH / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .attr("font-size", fontSize)
        .attr("fill", colors.text)
        .text((d) => truncateText(d.label, labelW - 14, fontSize));

    // --- AC panel ---
    const barH = clamp(Math.round(rowH * 0.44), 7, 18);
    rowSel
        .append("rect")
        .attr("class", "ibcs-ac-bar")
        .attr("x", xAc)
        .attr("y", (rowH - barH) / 2)
        .attr("width", (d) => (d.ac !== null && d.ac > 0 ? Math.max(1.5, d.ac * acScale) : 0))
        .attr("height", barH)
        .attr("fill", colors.ac)
        .attr("opacity", (d) => selectionOpacity(ctx, d.selectionId));

    if (showLabels) {
        rowSel
            .filter((d) => d.ac !== null)
            .each(function (d) {
                const barW = Math.max(1.5, (d.ac as number) * acScale);
                const text = formatter(d.ac as number);
                const textW = measureText(text, fontSize - 1);
                const fitsOutside = xAc + barW + 5 + textW <= xAc + wAc - 2;
                d3.select(this)
                    .append("text")
                    .attr("x", fitsOutside ? xAc + barW + 5 : xAc + barW - 4)
                    .attr("y", rowH / 2)
                    .attr("dy", "0.35em")
                    .attr("text-anchor", fitsOutside ? "start" : "end")
                    .attr("font-size", fontSize - 1)
                    .attr("fill", fitsOutside ? colors.text : "#FFFFFF")
                    .text(text);
            });
    }

    // --- absolute variance panel (horizontal diverging bars, Zebra BI style) ---
    if (showAbs) {
        const dHasNeg = maxNeg > 0;
        const labelPad = showLabels
            ? (d3.max(rows, (r) => (r.delta !== null ? measureText(formatSigned(formatter, r.delta), fontSize - 1) : 0)) ?? 0) + 6
            : 6;
        const x0 = xAbs + (dHasNeg ? labelPad : 4);
        const x1 = xAbs + wAbs - (maxPos > 0 ? labelPad : 4);
        const xScaleD = d3
            .scaleLinear()
            .domain([dHasNeg ? -maxNeg * 1.04 : 0, maxPos > 0 ? maxPos * 1.04 : 1])
            .range([x0, Math.max(x0 + 1, x1)]);
        const zeroXD = xScaleD(0);

        // shared zero axis across the whole column
        body.append("line")
            .attr("x1", zeroXD)
            .attr("x2", zeroXD)
            .attr("y1", 2)
            .attr("y2", rowH * rows.length - 2)
            .attr("stroke", "#BFBFBF")
            .attr("stroke-width", 1);

        rowSel
            .filter((d) => d.delta !== null && d.delta !== 0)
            .append("rect")
            .attr("class", "ibcs-delta-bar")
            .attr("x", (d) => Math.min(zeroXD, xScaleD(d.delta as number)))
            .attr("y", (rowH - barH) / 2)
            .attr("width", (d) => Math.max(1.5, Math.abs(xScaleD(d.delta as number) - zeroXD)))
            .attr("height", barH)
            .attr("fill", (d) => varianceColor(d.delta as number, goodDirection, colorMode, colors))
            .attr("opacity", (d) => selectionOpacity(ctx, d.selectionId));

        if (showLabels) {
            rowSel
                .filter((d) => d.delta !== null)
                .append("text")
                .attr("x", (d) => ((d.delta as number) >= 0 ? xScaleD(d.delta as number) + 4 : xScaleD(d.delta as number) - 4))
                .attr("y", rowH / 2)
                .attr("dy", "0.35em")
                .attr("text-anchor", (d) => ((d.delta as number) >= 0 ? "start" : "end"))
                .attr("font-size", fontSize - 1)
                .attr("fill", (d) => varianceColor(d.delta as number, goodDirection, colorMode, colors))
                .text((d) => formatSigned(formatter, d.delta as number));
        }
    }

    // --- percent variance panel (lollipop markers, right-aligned values) ---
    if (showPct && maxPctAbs > 0) {
        const labelPad = showLabels ? measureText("-00.0%", fontSize - 1) + 14 : 4;
        const x0 = xPct + 8;
        const x1 = xPct + wPct - labelPad;
        const domainMin = hasNegPct ? -maxPctAbs : 0;
        const domainMax = maxPctAbs;
        const xScale = d3.scaleLinear().domain([domainMin, domainMax * 1.04]).range([x0, x1]);
        const zeroX = xScale(0);

        // single zero axis across the column
        body.append("line")
            .attr("x1", zeroX)
            .attr("x2", zeroX)
            .attr("y1", 2)
            .attr("y2", rowH * rows.length - 2)
            .attr("stroke", "#BFBFBF")
            .attr("stroke-width", 1);

        rowSel
            .filter((d) => d.deltaPct !== null)
            .append("line")
            .attr("x1", zeroX)
            .attr("x2", (d) => xScale(d.deltaPct as number))
            .attr("y1", rowH / 2)
            .attr("y2", rowH / 2)
            .attr("stroke", (d) => varianceColor(d.deltaPct as number, goodDirection, colorMode, colors))
            .attr("stroke-width", 1.5);

        rowSel
            .filter((d) => d.deltaPct !== null)
            .append("circle")
            .attr("cx", (d) => xScale(d.deltaPct as number))
            .attr("cy", rowH / 2)
            .attr("r", 3)
            .attr("fill", (d) => varianceColor(d.deltaPct as number, goodDirection, colorMode, colors))
            .attr("opacity", (d) => selectionOpacity(ctx, d.selectionId));

        if (showLabels) {
            rowSel
                .filter((d) => d.deltaPct !== null)
                .append("text")
                .attr("x", xPct + wPct - 4)
                .attr("y", rowH / 2)
                .attr("dy", "0.35em")
                .attr("text-anchor", "end")
                .attr("font-size", fontSize - 1)
                .style("font-variant-numeric", "tabular-nums")
                .attr("fill", (d) => varianceColor(d.deltaPct as number, goodDirection, colorMode, colors))
                .text((d) => formatSignedPercent(d.deltaPct as number));
        }
    }

    // --- interaction overlay per row (invisible hit area) ---
    rowSel
        .append("rect")
        .attr("class", "ibcs-hit")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", rowH)
        .attr("fill", "transparent")
        .each(function (d) {
            const tooltipItems = (): TooltipItem[] => {
                const items: TooltipItem[] = [];
                if (d.ac !== null) {
                    items.push({ displayName: "AC", value: formatter(d.ac) });
                }
                if (baseKind && d.base !== null) {
                    items.push({ displayName: model.baseLabel, value: formatter(d.base) });
                }
                if (d.delta !== null) {
                    items.push({ displayName: `\u0394${baseKind}`, value: formatSigned(formatter, d.delta) });
                }
                if (d.deltaPct !== null) {
                    items.push({ displayName: `\u0394${baseKind}%`, value: formatSignedPercent(d.deltaPct) });
                }

                return items.concat(d.tooltipExtra);
            };
            bindInteractions(ctx, d3.select(this), () => d.selectionId, tooltipItems);
        });
}
