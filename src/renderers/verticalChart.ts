// Vertical (column) variance composite chart (Zebra BI style):
// columns = categories, panels = AC/base columns | absolute variance | percent variance.
//
// Design notes (IBCS / Zebra BI):
// - AC: solid vertical columns with the base scenario drawn behind as an
//   outline (hollow PY / hatched PL / dashed FC following IBCS notation)
// - Δabs: diverging vertical bars on a shared zero baseline per category slot
// - Δ%: vertical lollipop markers with values above the marker
// - category labels along the bottom (rotated when crowded)
//
// Rendering uses keyed D3 data joins so column groups are reused across
// updates, mirroring the horizontal variance renderer.

import * as d3 from "d3";
import { scenarioStyle, applyBarStyle, varianceColor, ensureHatchPattern } from "../ibcs";
import { formatSigned, formatSignedPercent, measureText, truncateText } from "../helpers";
import { RenderContext, bindInteractions, TooltipItem, clamp, cycleSort, sortArrow, SortField, dataPointOpacity, dataPointKey, tween, ensureChild } from "./common";
import { VarianceModel, VarianceRow } from "./varianceChart";

export function renderVerticalVarianceChart(ctx: RenderContext, model: VarianceModel): void {
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
    const xLabelH = fontSize + 12;
    const bottomPad = 4;
    const bodyH = Math.max(0, height - headerH - xLabelH - bottomPad);

    // Responsive density: only whole category slots are rendered.
    const minColW = 26;
    const availableW = width - 8;
    const needsOverflowNotice = allRows.length > Math.max(1, Math.floor((availableW * 0.42) / minColW));
    const overflowH = needsOverflowNotice ? fontSize + 7 : 0;
    const plotH = Math.max(0, bodyH - overflowH);

    const plotW = Math.max(0, availableW);
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

    const xAc = 4;
    const xAbs = xAc + wAc;
    const xPct = xAbs + wAbs;

    const visibleCount = Math.max(1, Math.floor(wAc / minColW));
    const rows = allRows.slice(0, visibleCount);
    const hiddenCount = allRows.length - rows.length;

    // --- headers (clickable for Zebra-style sorting) ---
    const sortField = String(settings.sortSettings.field.value ?? "none");
    const headerItems: Array<{ x: number; text: string; sort: SortField }> = [
        { x: xAc, text: `AC${sortField === "ac" ? sortArrow(ctx, "ac") : ""}`, sort: "ac" }
    ];
    if (showAbs) {
        headerItems.push({ x: xAbs, text: `\u0394${baseKind}${sortArrow(ctx, "delta")}`, sort: "delta" });
    }
    if (showPct) {
        headerItems.push({ x: xPct, text: `\u0394${baseKind}%${sortArrow(ctx, "deltaPct")}`, sort: "deltaPct" });
    }
    const header = svg
        .selectAll<SVGGElement, unknown>("g.ibcs-vheader")
        .data([null]);
    header
        .enter()
        .append("g")
        .attr("class", "ibcs-vheader")
        .merge(header)
        .selectAll<SVGTextElement, { x: number; text: string; sort: SortField }>("text")
        .data(headerItems, (d) => d.text)
        .join((enter) => enter.append("text"))
        .attr("x", (d) => d.x + 2)
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
        .selectAll<SVGGElement, unknown>("g.ibcs-vbody")
        .data([null]);
    const bodyMerged = body
        .enter()
        .append("g")
        .attr("class", "ibcs-vbody")
        .merge(body);
    bodyMerged.attr("transform", `translate(0, ${headerH})`);

    // --- scales ---
    const keys = new Map<VarianceRow, string>();
    rows.forEach((r, i) => keys.set(r, dataPointKey(r.label, r.selectionId, i)));
    const slotOf = (d: VarianceRow): string => keys.get(d) as string;

    const x = d3.scaleBand<string>()
        .domain(rows.map((r) => slotOf(r)))
        .range([0, Math.max(1, wAc)])
        .paddingInner(0.24)
        .paddingOuter(0.06);
    const bw = x.bandwidth();

    const acValues = rows.map((r) => r.ac).filter((v): v is number => v !== null);
    const maxAc = d3.max(acValues) ?? 0;
    const minAc = Math.min(0, d3.min(acValues) ?? 0);
    const acTopPad = showLabels ? fontSize + 4 : 4;
    const yAc = d3.scaleLinear()
        .domain([minAc, maxAc > minAc ? maxAc * 1.02 : minAc + 1])
        .range([plotH, acTopPad]);
    const zeroYAc = yAc(Math.max(0, minAc));

    const deltas = rows.map((r) => r.delta).filter((d): d is number => d !== null);
    const maxPos = d3.max(deltas.filter((d) => d > 0)) ?? 0;
    const maxNeg = d3.max(deltas.filter((d) => d < 0).map((d) => -d)) ?? 0;

    const pcts = rows.map((r) => r.deltaPct).filter((d): d is number => d !== null);
    const maxPctAbs = d3.max(pcts.map((p) => Math.abs(p))) ?? 0;
    const hasNegPct = pcts.some((p) => p < 0);

    // --- column groups (keyed join) ---
    const colSel = bodyMerged
        .selectAll<SVGGElement, VarianceRow>("g.ibcs-vcol")
        .data(rows, (d, i) => dataPointKey(d.label, d.selectionId, i))
        .join((enter) => {
            const g = enter.append("g").attr("class", "ibcs-vcol");
            g.append("rect").attr("class", "ibcs-hit").attr("fill", "transparent");
            g.append("rect").attr("class", "ibcs-vbase-bar");
            g.append("rect").attr("class", "ibcs-vac-bar");

            return g;
        })
        .each(function (d) {
            d3.select(this).attr("transform", `translate(${x(slotOf(d)) ?? 0}, 0)`);
        });

    if (!showAbs) {
        colSel.selectAll(".ibcs-vdelta-bar, .ibcs-vdelta-value").remove();
    }
    if (!showPct) {
        colSel.selectAll(".ibcs-vpct-stem, .ibcs-vpct-dot, .ibcs-vpct-value").remove();
    }
    if (!showLabels) {
        colSel.selectAll(".ibcs-vac-value, .ibcs-vdelta-value, .ibcs-vpct-value").remove();
    }
    if (!baseKind) {
        colSel.selectAll(".ibcs-vbase-bar").remove();
    }

    const baseStyle = baseKind ? scenarioStyle(baseKind, colors) : null;

    // --- AC panel: base outline behind, AC solid in front ---
    colSel.each(function (d) {
        const col = d3.select(this);
        const cx = bw / 2;
        if (d.base !== null && baseStyle) {
            const baseH = Math.abs(yAc(d.base) - zeroYAc);
            ensureChild<SVGRectElement>(col, ".ibcs-vbase-bar", "rect", "ibcs-vbase-bar")
                .attr("x", cx - bw * 0.46)
                .attr("width", bw * 0.92)
                .attr("y", d.base >= 0 ? yAc(d.base) : zeroYAc)
                .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                .each(function () {
                    tween(ctx, d3.select(this)).attr("height", Math.max(1, baseH));
                });
            applyBarStyle(col.select(".ibcs-vbase-bar") as d3.Selection<SVGRectElement, unknown, null, undefined>, baseStyle);
        } else {
            col.select(".ibcs-vbase-bar").remove();
        }

        const acBar = ensureChild<SVGRectElement>(col, ".ibcs-vac-bar", "rect", "ibcs-vac-bar");
        const acH = d.ac !== null ? Math.abs(yAc(d.ac) - zeroYAc) : 0;
        acBar
            .attr("x", cx - bw * 0.31)
            .attr("width", bw * 0.62)
            .attr("fill", colors.ac)
            .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
            .each(function () {
                const top = d.ac !== null ? (d.ac >= 0 ? yAc(d.ac) : zeroYAc) : zeroYAc;
                d3.select(this).attr("y", top);
                tween(ctx, d3.select(this)).attr("height", Math.max(d.ac !== null ? 1 : 0, acH));
            });

        if (showLabels && d.ac !== null) {
            ensureChild<SVGTextElement>(col, ".ibcs-vac-value", "text", "ibcs-vac-value")
                .attr("x", cx)
                .attr("y", d.ac >= 0 ? yAc(d.ac) - 3 : zeroYAc + acH + fontSize - 2)
                .attr("text-anchor", "middle")
                .attr("font-size", Math.max(8, fontSize - 1))
                .attr("fill", colors.text)
                .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                .text(formatter(d.ac));
        } else {
            col.select(".ibcs-vac-value").remove();
        }

        // category label at the bottom
        ensureChild<SVGTextElement>(col, ".ibcs-vlabel", "text", "ibcs-vlabel")
            .attr("x", cx)
            .attr("y", plotH + fontSize + 4)
            .attr("text-anchor", "middle")
            .attr("font-size", fontSize - 1)
            .attr("fill", colors.text)
            .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
            .text(truncateText(d.label, Math.max(24, bw + 14), fontSize - 1));
    });

    // --- absolute variance panel (diverging vertical bars) ---
    if (showAbs) {
        const labelPad = showLabels ? fontSize + 6 : 4;
        const yAbs = d3.scaleLinear()
            .domain([maxNeg > 0 ? -maxNeg * 1.04 : 0, maxPos > 0 ? maxPos * 1.04 : 1])
            .range([plotH - labelPad, labelPad]);
        const zeroYAbs = yAbs(0);

        const axis = bodyMerged
            .selectAll<SVGLineElement, unknown>("line.ibcs-vaxis-abs")
            .data([null]);
        axis
            .enter()
            .append("line")
            .attr("class", "ibcs-vaxis-abs")
            .merge(axis)
            .attr("x1", xAbs)
            .attr("x2", xAbs + wAbs)
            .attr("y1", zeroYAbs)
            .attr("y2", zeroYAbs)
            .attr("stroke", "#BFBFBF")
            .attr("stroke-width", 1);

        colSel.each(function (d) {
            const col = d3.select(this);
            // Variance panels share the category slot geometry but sit at
            // their own x offset, so translate within the column group.
            if (d.delta === null || d.delta === 0) {
                col.selectAll(".ibcs-vdelta-bar, .ibcs-vdelta-value").remove();

                return;
            }
            const barW = clamp(bw * 0.5, 3, 22);
            const h = Math.max(1.5, Math.abs(yAbs(d.delta) - zeroYAbs));
            ensureChild<SVGRectElement>(col, ".ibcs-vdelta-bar", "rect", "ibcs-vdelta-bar")
                .attr("x", xAbs - (x(slotOf(d)) ?? 0) + bw / 2 - barW / 2)
                .attr("width", barW)
                .attr("fill", varianceColor(d.delta, goodDirection, colorMode, colors))
                .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                .each(function () {
                    d3.select(this).attr("y", d.delta >= 0 ? yAbs(d.delta) : zeroYAbs);
                    tween(ctx, d3.select(this)).attr("height", h);
                });
            if (showLabels) {
                ensureChild<SVGTextElement>(col, ".ibcs-vdelta-value", "text", "ibcs-vdelta-value")
                    .attr("x", xAbs - (x(slotOf(d)) ?? 0) + bw / 2)
                    .attr("y", (d.delta >= 0 ? yAbs(d.delta) - 3 : zeroYAbs + h + fontSize - 2))
                    .attr("text-anchor", "middle")
                    .attr("font-size", Math.max(8, fontSize - 1))
                    .attr("fill", varianceColor(d.delta, goodDirection, colorMode, colors))
                    .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                    .text(formatSigned(formatter, d.delta));
            } else {
                col.select(".ibcs-vdelta-value").remove();
            }
        });
    } else {
        bodyMerged.selectAll("line.ibcs-vaxis-abs").remove();
    }

    // --- percent variance panel (vertical lollipop markers) ---
    if (showPct && maxPctAbs > 0) {
        const labelPad = showLabels ? fontSize + 6 : 4;
        const domainMin = hasNegPct ? -maxPctAbs : 0;
        const yPct = d3.scaleLinear()
            .domain([domainMin, maxPctAbs * 1.04])
            .range([plotH - labelPad, labelPad]);
        const zeroYPct = yPct(0);

        const axis = bodyMerged
            .selectAll<SVGLineElement, unknown>("line.ibcs-vaxis-pct")
            .data([null]);
        axis
            .enter()
            .append("line")
            .attr("class", "ibcs-vaxis-pct")
            .merge(axis)
            .attr("x1", xPct)
            .attr("x2", xPct + wPct)
            .attr("y1", zeroYPct)
            .attr("y2", zeroYPct)
            .attr("stroke", "#BFBFBF")
            .attr("stroke-width", 1);

        colSel.each(function (d) {
            const col = d3.select(this);
            if (d.deltaPct === null) {
                col.selectAll(".ibcs-vpct-stem, .ibcs-vpct-dot, .ibcs-vpct-value").remove();

                return;
            }
            const offset = xPct - (x(slotOf(d)) ?? 0);
            const cx = offset + bw / 2;
            const color = varianceColor(d.deltaPct, goodDirection, colorMode, colors);
            ensureChild<SVGLineElement>(col, ".ibcs-vpct-stem", "line", "ibcs-vpct-stem")
                .attr("x1", cx)
                .attr("x2", cx)
                .attr("y1", zeroYPct)
                .attr("y2", yPct(d.deltaPct))
                .attr("stroke", color)
                .attr("stroke-width", 1.5);
            ensureChild<SVGCircleElement>(col, ".ibcs-vpct-dot", "circle", "ibcs-vpct-dot")
                .attr("cx", cx)
                .attr("cy", yPct(d.deltaPct))
                .attr("r", 3)
                .attr("fill", color)
                .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted));
            if (showLabels) {
                ensureChild<SVGTextElement>(col, ".ibcs-vpct-value", "text", "ibcs-vpct-value")
                    .attr("x", cx)
                    .attr("y", d.deltaPct >= 0 ? yPct(d.deltaPct) - 6 : yPct(d.deltaPct) + fontSize)
                    .attr("text-anchor", "middle")
                    .attr("font-size", Math.max(8, fontSize - 1))
                    .style("font-variant-numeric", "tabular-nums")
                    .attr("fill", color)
                    .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                    .text(formatSignedPercent(d.deltaPct));
            } else {
                col.select(".ibcs-vpct-value").remove();
            }
        });
    } else {
        bodyMerged.selectAll("line.ibcs-vaxis-pct").remove();
    }

    // Hit areas sit behind every panel element and cover the full body height
    // for the category slot, matching the horizontal chart's row hit areas.
    colSel
        .select<SVGRectElement>("rect.ibcs-hit")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", plotH)
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
