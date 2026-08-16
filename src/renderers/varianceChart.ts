// Variance composite chart (Zebra BI style):
// rows = categories, columns = AC bar | absolute variance bars | percent variance markers.
//
// Design notes (IBCS / Zebra BI):
// - AC: solid horizontal bars, value label right of the bar (inside when space is tight)
// - ΔPY: vertical variance bars on a shared zero baseline per row band
// - ΔPY%: lollipop markers on a shared scale, values right-aligned at the column edge
// - single zero axis line per variance column, hairline row separators
//
// Rendering uses keyed D3 data joins so row groups are reused across updates
// (geometry animates instead of the whole SVG being rebuilt).

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, varianceColor, ensureHatchPattern } from "../ibcs";
import { formatSigned, formatSignedPercent, measureText, truncateText } from "../helpers";
import { RenderContext, bindInteractions, TooltipItem, clamp, configuredRowHeight, cycleSort, sortArrow, SortField, dataPointOpacity, dataPointKey, tween, ensureChild, computeTotals, totalsOpacity, nonSelectableId, Totals, detectOutlierLimit, isOutlierValue } from "./common";

export interface VarianceRow {
    label: string;
    selectionId: powerbi.visuals.ISelectionId;
    selectionIds?: powerbi.visuals.ISelectionId[];
    ac: number | null;
    base: number | null;
    delta: number | null;
    deltaPct: number | null;
    /** Cross-visual highlight state for this row. */
    highlighted: boolean;
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

    const allRows = model.rows;
    const baseKind = model.baseKind;
    let showAbs = settings.variance.showDeltaAbs.value && baseKind !== null;
    let showPct = settings.variance.showDeltaPct.value && baseKind !== null;
    const colorMode = settings.variance.colorMode.value as "semantic" | "neutral";
    const goodDirection = settings.variance.goodDirection.value as "up" | "down";
    const showLabels = settings.labels?.showValueLabels?.value !== false;

    const headerH = fontSize + 12;
    const bottomPad = 4;
    const showTotals = settings.chart?.showTotals?.value === true && allRows.length > 0;
    const configuredRowH = configuredRowHeight(ctx);
    const minRowH = configuredRowH || Math.max(14, fontSize + 4);
    const initialRowArea = Math.max(0, height - headerH - bottomPad);
    const needsOverflowNotice = allRows.length + (showTotals ? 1 : 0) > Math.max(1, Math.floor(initialRowArea / minRowH));
    const overflowH = needsOverflowNotice ? fontSize + 7 : 0;
    const rowArea = Math.max(0, initialRowArea - overflowH);
    const visibleCount = Math.max(1, Math.floor(rowArea / minRowH) - (showTotals ? 1 : 0));
    const rows = allRows.slice(0, visibleCount);
    const hiddenCount = allRows.length - rows.length;
    // Fill mode (rowHeight = 0): rows divide the whole row area evenly, like
    // native chart columns fill the plot area. A positive value pins rows.
    const rowH = rows.length > 0
        ? (configuredRowH || Math.max(1, rowArea / (rows.length + (showTotals ? 1 : 0))))
        : 0;
    const showGridlines = settings.gridlines?.show?.value !== false;

    // --- label column ---
    const configuredLabelW = settings.notation.labelWidth.value;
    const maxLabelPx = d3.max(rows, (r) => measureText(r.label, fontSize)) ?? 0;
    const maxLabelW = Math.max(22, width * 0.36);
    const labelW = configuredLabelW > 0
        ? clamp(configuredLabelW, 22, maxLabelW)
        : clamp(maxLabelPx + 20, 22, maxLabelW);

    const gap = 14;
    const plotW = Math.max(0, width - labelW - gap);
    if (showAbs && showPct && plotW < 210) {
        showPct = false;
    }
    if (showAbs && plotW < 130) {
        showAbs = false;
    }
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

    // --- scales (outlier-aware: a dominant outlier is drawn truncated with
    // a break mark while the remaining rows use the magnified scale) ---
    const outlierEnabled = String(settings.notation?.outlierScale?.value ?? "auto") !== "off";
    const outlierLimit = detectOutlierLimit(rows.map((r) => r.ac), outlierEnabled);
    const hasOutlier = outlierLimit !== Infinity;
    const normalRows = hasOutlier ? rows.filter((r) => !isOutlierValue(r.ac, outlierLimit)) : rows;

    const maxAc = d3.max(rows, (r) => (r.ac !== null && r.ac > 0 ? r.ac : 0)) ?? 0;
    const normalMaxAc = hasOutlier ? outlierLimit : maxAc;
    const deltas = normalRows.map((r) => r.delta).filter((d): d is number => d !== null);
    const maxPos = d3.max(deltas.filter((d) => d > 0)) ?? 0;
    const maxNeg = d3.max(deltas.filter((d) => d < 0).map((d) => -d)) ?? 0;
    const pcts = normalRows.map((r) => r.deltaPct).filter((d): d is number => d !== null);
    const maxPctAbs = d3.max(pcts.map((p) => Math.abs(p))) ?? 0;
    const hasNegPct = pcts.some((p) => p < 0);

    const acRange = wAc * 0.72; // reserve room for outside labels
    const acScale = normalMaxAc > 0 ? acRange / normalMaxAc : 0;

    /** Two slanted hairlines marking a truncated (broken) bar. */
    const drawBreakMarks = (
        parent: d3.Selection<any, any, any, unknown>,
        selector: string,
        edgeX: number,
        y: number,
        h: number
    ): void => {
        const g = ensureChild<SVGGElement>(parent, selector, "g", "ibcs-break");
        g
            .selectAll("line")
            .data([0, 1])
            .join((enter) => enter.append("line"))
            .attr("x1", (_d, i) => edgeX - 9 + i * 5)
            .attr("x2", (_d, i) => edgeX - 6 + i * 5)
            .attr("y1", y - 1)
            .attr("y2", y + h + 1)
            .attr("stroke", colors.inverseText)
            .attr("stroke-width", 2);
    };

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
    const header = svg
        .selectAll<SVGGElement, unknown>("g.ibcs-header")
        .data([null]);
    header
        .enter()
        .append("g")
        .attr("class", "ibcs-header")
        .merge(header)
        .selectAll<SVGTextElement, { x: number; text: string; sort: SortField }>("text")
        .data(headerItems, (d) => d.text)
        .join((enter) => enter.append("text"))
        .attr("x", (d) => d.x)
        .attr("y", headerH - 7)
        .attr("font-size", fontSize - 1)
        .attr("font-weight", 600)
        .attr("fill", colors.outline)
        .attr("tabindex", ctx.allowInteractions ? 0 : null)
        .attr("role", "button")
        .attr("aria-label", (d) => d.text)
        .style("cursor", "pointer")
        .text((d) => d.text)
        .on("click", (event: MouseEvent, d) => {
            event.stopPropagation();
            cycleSort(ctx, d.sort);
        })
        .on("keydown", (event: KeyboardEvent, d) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                cycleSort(ctx, d.sort);
            }
        });

    const body = svg
        .selectAll<SVGGElement, unknown>("g.ibcs-body")
        .data([null]);
    const bodyMerged = body
        .enter()
        .append("g")
        .attr("class", "ibcs-body")
        .merge(body);
    bodyMerged.attr("transform", `translate(0, ${headerH})`);

    const rowSel = bodyMerged
        .selectAll<SVGGElement, VarianceRow>("g.ibcs-row")
        .data(rows, (d, i) => dataPointKey(d.label, d.selectionId, i))
        .join((enter) => {
            const g = enter.append("g").attr("class", "ibcs-row");
            g.append("rect").attr("class", "ibcs-hit").attr("fill", "transparent");
            g.append("text").attr("class", "ibcs-cat-label");
            g.append("rect").attr("class", "ibcs-ac-bar");

            return g;
        })
        .each(function (d, i) {
            // Rows animate vertically when sorting changes; children keep
            // absolute coordinates inside the row band.
            tween(ctx, d3.select(this)).attr("transform", `translate(0, ${i * rowH})`);
            d3.select(this).attr("data-label", d.label);
        });

    // Drop children that the current layout no longer shows, so toggling
    // variance columns or labels never leaves stale geometry behind.
    if (!showAbs) {
        rowSel.selectAll(".ibcs-delta-bar, .ibcs-delta-value").remove();
    }
    if (!showPct) {
        rowSel.selectAll(".ibcs-pct-stem, .ibcs-pct-dot, .ibcs-pct-value").remove();
    }
    if (!showLabels) {
        rowSel.selectAll(".ibcs-ac-value, .ibcs-delta-value, .ibcs-pct-value").remove();
    }

    // category labels (right aligned, IBCS table convention)
    rowSel
        .select<SVGTextElement>("text.ibcs-cat-label")
        .attr("x", labelW - 10)
        .attr("y", rowH / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .attr("font-size", fontSize)
        .attr("fill", colors.text)
        .attr("opacity", (d) => dataPointOpacity(ctx, d.selectionId, d.highlighted))
        .text((d) => truncateText(d.label, labelW - 14, fontSize));

    // hairline separators (inserted after the hit rect, before content)
    rowSel.each(function (_d, i) {
        const row = d3.select(this);
        const sep = row.select<SVGLineElement>("line.ibcs-sep");
        if (i > 0 && showGridlines) {
            if (sep.empty()) {
                row.insert("line", ":nth-child(2)").attr("class", "ibcs-sep");
            }
            row.select("line.ibcs-sep")
                .attr("x1", 0)
                .attr("x2", width)
                .attr("y1", 0)
                .attr("y2", 0)
                .attr("stroke", colors.grid)
                .attr("stroke-width", 1);
        } else {
            sep.remove();
        }
    });

    // --- AC panel ---
    const barH = clamp(Math.round(rowH * 0.44), 7, 40);
    rowSel
        .select<SVGRectElement>("rect.ibcs-ac-bar")
        .attr("x", xAc)
        .attr("y", (rowH - barH) / 2)
        .attr("height", barH)
        .attr("fill", colors.ac)
        .attr("opacity", (d) => dataPointOpacity(ctx, d.selectionId, d.highlighted))
        .each(function (d) {
            const truncated = isOutlierValue(d.ac, outlierLimit);
            const shown = d.ac !== null && d.ac > 0 ? Math.min(d.ac, outlierLimit) : 0;
            const w = Math.max(1.5, shown * acScale);
            tween(ctx, d3.select(this)).attr("width", w);
            const rowGroup = d3.select(this.parentNode as SVGGElement);
            if (truncated) {
                drawBreakMarks(rowGroup, ".ibcs-break", xAc + w, (rowH - barH) / 2, barH);
            } else {
                rowGroup.select(".ibcs-break").remove();
            }
        });

    rowSel.each(function (d) {
        if (!showLabels || d.ac === null) {
            d3.select(this).select(".ibcs-ac-value").remove();

            return;
        }
        const row = d3.select(this);
        const barW = Math.max(1.5, Math.min(d.ac as number, outlierLimit) * acScale);
        const text = formatter(d.ac as number);
        const textW = measureText(text, fontSize - 1);
        const fitsOutside = xAc + barW + 5 + textW <= xAc + wAc - 2;
        ensureChild<SVGTextElement>(row, ".ibcs-ac-value", "text", "ibcs-ac-value")
            .attr("x", fitsOutside ? xAc + barW + 5 : xAc + barW - 4)
            .attr("y", rowH / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", fitsOutside ? "start" : "end")
            .attr("font-size", fontSize - 1)
            .attr("fill", fitsOutside ? colors.text : colors.inverseText)
            .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
            .text(text);
    });

    // --- absolute variance panel (horizontal diverging bars, Zebra BI style) ---
    let zeroXD = 0;
    let xScaleD: d3.ScaleLinear<number, number> | null = null;
    if (showAbs) {
        const dHasNeg = maxNeg > 0;
        const labelPad = showLabels
            ? (d3.max(rows, (r) => (r.delta !== null ? measureText(formatSigned(formatter, r.delta), fontSize - 1) : 0)) ?? 0) + 6
            : 6;
        const x0 = xAbs + (dHasNeg ? labelPad : 4);
        const x1 = xAbs + wAbs - (maxPos > 0 ? labelPad : 4);
        xScaleD = d3
            .scaleLinear()
            .domain([dHasNeg ? -maxNeg * 1.04 : 0, maxPos > 0 ? maxPos * 1.04 : 1])
            .range([x0, Math.max(x0 + 1, x1)]);
        zeroXD = xScaleD(0);

        // shared zero axis across the whole column
        const axis = bodyMerged
            .selectAll<SVGLineElement, unknown>("line.ibcs-axis-abs")
            .data(showAbs ? [null] : []);
        axis
            .enter()
            .append("line")
            .attr("class", "ibcs-axis-abs")
            .merge(axis)
            .attr("x1", zeroXD)
            .attr("x2", zeroXD)
            .attr("y1", 2)
            .attr("y2", rowH * rows.length - 2)
            .attr("stroke", "#BFBFBF")
            .attr("stroke-width", 1);

        rowSel.each(function (d) {
            const row = d3.select(this);
            if (d.delta === null || d.delta === 0) {
                row.select(".ibcs-delta-bar").remove();
                row.select(".ibcs-delta-value").remove();

                return;
            }
            const scale = xScaleD as d3.ScaleLinear<number, number>;
            const domain = scale.domain();
            const truncatedDelta = Math.abs(d.delta) > Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
            const xd = scale(clamp(d.delta, domain[0], domain[1]));
            const barX = Math.min(zeroXD, xd);
            const barW = Math.max(1.5, Math.abs(xd - zeroXD));
            ensureChild<SVGRectElement>(row, ".ibcs-delta-bar", "rect", "ibcs-delta-bar")
                .attr("x", barX)
                .attr("y", (rowH - barH) / 2)
                .attr("height", barH)
                .attr("fill", varianceColor(d.delta, goodDirection, colorMode, colors))
                .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                .each(function () {
                    tween(ctx, d3.select(this)).attr("width", barW);
                });
            if (truncatedDelta) {
                drawBreakMarks(row, ".ibcs-delta-break", d.delta >= 0 ? barX + barW : barX, (rowH - barH) / 2, barH);
            } else {
                row.select(".ibcs-delta-break").remove();
            }
            if (showLabels) {
                ensureChild<SVGTextElement>(row, ".ibcs-delta-value", "text", "ibcs-delta-value")
                    .attr("x", d.delta >= 0 ? xd + 4 : xd - 4)
                    .attr("y", rowH / 2)
                    .attr("dy", "0.35em")
                    .attr("text-anchor", d.delta >= 0 ? "start" : "end")
                    .attr("font-size", fontSize - 1)
                    .attr("fill", varianceColor(d.delta, goodDirection, colorMode, colors))
                    .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                    .text(formatSigned(formatter, d.delta));
            } else {
                row.select(".ibcs-delta-value").remove();
            }
        });
    } else {
        bodyMerged.selectAll("line.ibcs-axis-abs").remove();
    }

    // --- percent variance panel (lollipop markers, right-aligned values) ---
    let xScalePct: d3.ScaleLinear<number, number> | null = null;
    if (showPct && maxPctAbs > 0) {
        const labelPad = showLabels ? measureText("-00.0%", fontSize - 1) + 14 : 4;
        const x0 = xPct + 8;
        const x1 = xPct + wPct - labelPad;
        const domainMin = hasNegPct ? -maxPctAbs : 0;
        const domainMax = maxPctAbs;
        const xScale = d3.scaleLinear().domain([domainMin, domainMax * 1.04]).range([x0, x1]);
        xScalePct = xScale;
        const zeroX = xScale(0);

        // single zero axis across the column
        const axis = bodyMerged
            .selectAll<SVGLineElement, unknown>("line.ibcs-axis-pct")
            .data([null]);
        axis
            .enter()
            .append("line")
            .attr("class", "ibcs-axis-pct")
            .merge(axis)
            .attr("x1", zeroX)
            .attr("x2", zeroX)
            .attr("y1", 2)
            .attr("y2", rowH * rows.length - 2)
            .attr("stroke", "#BFBFBF")
            .attr("stroke-width", 1);

        rowSel.each(function (d) {
            const row = d3.select(this);
            if (d.deltaPct === null) {
                row.selectAll(".ibcs-pct-stem, .ibcs-pct-dot, .ibcs-pct-value").remove();

                return;
            }
            const color = varianceColor(d.deltaPct, goodDirection, colorMode, colors);
            const pctDomain = xScale.domain();
            const xp = xScale(clamp(d.deltaPct, pctDomain[0], pctDomain[1]));
            ensureChild<SVGLineElement>(row, ".ibcs-pct-stem", "line", "ibcs-pct-stem")
                .attr("x1", zeroX)
                .attr("x2", xp)
                .attr("y1", rowH / 2)
                .attr("y2", rowH / 2)
                .attr("stroke", color)
                .attr("stroke-width", 1.5);
            ensureChild<SVGCircleElement>(row, ".ibcs-pct-dot", "circle", "ibcs-pct-dot")
                .attr("cx", xp)
                .attr("cy", rowH / 2)
                .attr("r", 3)
                .attr("fill", color)
                .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted));
            if (showLabels) {
                ensureChild<SVGTextElement>(row, ".ibcs-pct-value", "text", "ibcs-pct-value")
                    .attr("x", xPct + wPct - 4)
                    .attr("y", rowH / 2)
                    .attr("dy", "0.35em")
                    .attr("text-anchor", "end")
                    .attr("font-size", fontSize - 1)
                    .style("font-variant-numeric", "tabular-nums")
                    .attr("fill", color)
                    .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                    .text(formatSignedPercent(d.deltaPct));
            } else {
                row.select(".ibcs-pct-value").remove();
            }
        });
    } else {
        bodyMerged.selectAll("line.ibcs-axis-pct").remove();
    }

    // Keep the interaction surface behind bars and labels. SVG's
    // "transparent" is painted, and host compositing must never be allowed
    // to cover the visible content after a resize/format update.
    rowSel
        .select<SVGRectElement>("rect.ibcs-hit")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", rowH)
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
            bindInteractions(ctx, d3.select(this), () => d.selectionIds ?? d.selectionId, tooltipItems);
        });

    // --- totals row (aggregated, tooltip-only, never selectable) ---
    const totalsData = showTotals ? [computeTotals(allRows)] : [];
    const totalsSel = bodyMerged
        .selectAll<SVGGElement, Totals>("g.ibcs-total")
        .data(totalsData);
    totalsSel.exit().remove();
    const totalsMerged = totalsSel
        .enter()
        .append("g")
        .attr("class", "ibcs-total")
        .merge(totalsSel);
    if (showTotals) {
        const t = computeTotals(allRows);
        const opacity = totalsOpacity(ctx, allRows.some((r) => r.highlighted));
        const totalLabel = ctx.localization.getDisplayName("Visual_Total");
        totalsMerged.attr("transform", `translate(0, ${rows.length * rowH})`);

        ensureChild<SVGLineElement>(totalsMerged, ".ibcs-total-rule", "line", "ibcs-total-rule")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", colors.outline)
            .attr("stroke-width", 1.25);
        ensureChild<SVGTextElement>(totalsMerged, ".ibcs-total-label", "text", "ibcs-total-label")
            .attr("x", labelW - 10)
            .attr("y", rowH / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("font-size", fontSize)
            .attr("font-weight", 600)
            .attr("fill", colors.text)
            .attr("opacity", opacity)
            .text(totalLabel);

        const totalShown = t.ac !== null && t.ac > 0 ? Math.min(t.ac, outlierLimit) : 0;
        const totalBarW = Math.min(Math.max(1.5, totalShown * acScale), wAc * 0.9);
        ensureChild<SVGRectElement>(totalsMerged, ".ibcs-total-ac-bar", "rect", "ibcs-total-ac-bar")
            .attr("x", xAc)
            .attr("y", (rowH - barH) / 2)
            .attr("height", barH)
            .attr("fill", colors.ac)
            .attr("opacity", opacity)
            .each(function () {
                tween(ctx, d3.select(this)).attr("width", totalBarW);
            });
        if (t.ac !== null && isOutlierValue(t.ac, outlierLimit)) {
            drawBreakMarks(totalsMerged, ".ibcs-total-break", xAc + totalBarW, (rowH - barH) / 2, barH);
        } else {
            totalsMerged.select(".ibcs-total-break").remove();
        }
        if (showLabels && t.ac !== null) {
            ensureChild<SVGTextElement>(totalsMerged, ".ibcs-total-ac-value", "text", "ibcs-total-ac-value")
                .attr("x", xAc + totalBarW + 5)
                .attr("y", rowH / 2)
                .attr("dy", "0.35em")
                .attr("font-size", fontSize - 1)
                .attr("font-weight", 600)
                .attr("fill", colors.text)
                .attr("opacity", opacity)
                .text(formatter(t.ac));
        } else {
            totalsMerged.select(".ibcs-total-ac-value").remove();
        }

        if (xScaleD && t.delta !== null) {
            const xd = xScaleD(clamp(t.delta, xScaleD.domain()[0], xScaleD.domain()[1]));
            const barX = Math.min(zeroXD, xd);
            const barW = Math.max(1.5, Math.abs(xd - zeroXD));
            ensureChild<SVGRectElement>(totalsMerged, ".ibcs-total-delta-bar", "rect", "ibcs-total-delta-bar")
                .attr("x", barX)
                .attr("y", (rowH - barH) / 2)
                .attr("height", barH)
                .attr("fill", varianceColor(t.delta, goodDirection, colorMode, colors))
                .attr("opacity", opacity)
                .each(function () {
                    tween(ctx, d3.select(this)).attr("width", barW);
                });
            if (showLabels) {
                ensureChild<SVGTextElement>(totalsMerged, ".ibcs-total-delta-value", "text", "ibcs-total-delta-value")
                    .attr("x", t.delta >= 0 ? xd + 4 : xd - 4)
                    .attr("y", rowH / 2)
                    .attr("dy", "0.35em")
                    .attr("text-anchor", t.delta >= 0 ? "start" : "end")
                    .attr("font-size", fontSize - 1)
                    .attr("font-weight", 600)
                    .attr("fill", varianceColor(t.delta, goodDirection, colorMode, colors))
                    .attr("opacity", opacity)
                    .text(formatSigned(formatter, t.delta));
            } else {
                totalsMerged.select(".ibcs-total-delta-value").remove();
            }
        } else {
            totalsMerged.select(".ibcs-total-delta-bar").remove();
            totalsMerged.select(".ibcs-total-delta-value").remove();
        }

        if (xScalePct && t.deltaPct !== null) {
            const xp = xScalePct(clamp(t.deltaPct, xScalePct.domain()[0], xScalePct.domain()[1]));
            const zeroX = xScalePct(0);
            const color = varianceColor(t.deltaPct, goodDirection, colorMode, colors);
            ensureChild<SVGLineElement>(totalsMerged, ".ibcs-total-pct-stem", "line", "ibcs-total-pct-stem")
                .attr("x1", zeroX)
                .attr("x2", xp)
                .attr("y1", rowH / 2)
                .attr("y2", rowH / 2)
                .attr("stroke", color)
                .attr("stroke-width", 1.5);
            ensureChild<SVGCircleElement>(totalsMerged, ".ibcs-total-pct-dot", "circle", "ibcs-total-pct-dot")
                .attr("cx", xp)
                .attr("cy", rowH / 2)
                .attr("r", 3)
                .attr("fill", color)
                .attr("opacity", opacity);
            if (showLabels) {
                ensureChild<SVGTextElement>(totalsMerged, ".ibcs-total-pct-value", "text", "ibcs-total-pct-value")
                    .attr("x", xPct + wPct - 4)
                    .attr("y", rowH / 2)
                    .attr("dy", "0.35em")
                    .attr("text-anchor", "end")
                    .attr("font-size", fontSize - 1)
                    .attr("font-weight", 600)
                    .style("font-variant-numeric", "tabular-nums")
                    .attr("fill", color)
                    .attr("opacity", opacity)
                    .text(formatSignedPercent(t.deltaPct));
            } else {
                totalsMerged.select(".ibcs-total-pct-value").remove();
            }
        } else {
            totalsMerged.selectAll(".ibcs-total-pct-stem, .ibcs-total-pct-dot, .ibcs-total-pct-value").remove();
        }

        ensureChild<SVGRectElement>(totalsMerged, ".ibcs-hit", "rect", "ibcs-hit")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", width)
            .attr("height", rowH)
            .attr("fill", "transparent")
            .each(function () {
                const tooltipItems = (): TooltipItem[] => {
                    const items: TooltipItem[] = [];
                    if (t.ac !== null) {
                        items.push({ displayName: "AC", value: formatter(t.ac) });
                    }
                    if (baseKind && t.base !== null) {
                        items.push({ displayName: model.baseLabel, value: formatter(t.base) });
                    }
                    if (t.delta !== null) {
                        items.push({ displayName: `\u0394${baseKind}`, value: formatSigned(formatter, t.delta) });
                    }
                    if (t.deltaPct !== null) {
                        items.push({ displayName: `\u0394${baseKind}%`, value: formatSignedPercent(t.deltaPct) });
                    }

                    return items;
                };
                bindInteractions(ctx, d3.select(this), () => nonSelectableId(), tooltipItems);
            });
    }

    const overflow = svg
        .selectAll<SVGTextElement, number>("text.ibcs-overflow-note")
        .data(hiddenCount > 0 ? [hiddenCount] : []);
    overflow
        .enter()
        .append("text")
        .attr("class", "ibcs-overflow-note")
        .merge(overflow)
        .attr("x", width - 4)
        .attr("y", height - 4)
        .attr("text-anchor", "end")
        .attr("font-size", Math.max(8, fontSize - 1))
        .attr("fill", colors.outline)
        .text((count) => ctx.localization.getDisplayName("Visual_MoreRows").replace("{0}", String(count)));
    overflow.exit().remove();
}
