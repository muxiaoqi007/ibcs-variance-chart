// IBCS semantic table: right-aligned figures, scenario abbreviation headers,
// green/red variance figures following the good-direction setting.
//
// Rendering uses keyed D3 data joins so row groups are reused across updates.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, varianceColor } from "../ibcs";
import { formatSigned, formatSignedPercent, measureText, truncateText } from "../helpers";
import { RenderContext, bindInteractions, TooltipItem, clamp, configuredRowHeight, cycleSort, sortArrow, SortField, dataPointOpacity, dataPointKey, tween, ensureChild, computeTotals, totalsOpacity, nonSelectableId, Totals } from "./common";

export interface TableModel {
    rows: Array<{
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
    }>;
    baseKind: ScenarioKind | null;
    baseLabel: string;
}

export function renderTable(ctx: RenderContext, model: TableModel): void {
    const { svg, width, height, colors, settings, formatter, fontSize } = ctx;

    const allRows = model.rows;
    if (allRows.length === 0) {
        return;
    }
    const baseKind = model.baseKind;
    let showBase = baseKind !== null;
    let showAbs = settings.variance.showDeltaAbs.value && showBase;
    let showPct = settings.variance.showDeltaPct.value && showBase;
    const colorMode = settings.variance.colorMode.value as "semantic" | "neutral";
    const goodDirection = settings.variance.goodDirection.value as "up" | "down";

    const headerH = fontSize + 12;
    const showTotals = settings.chart?.showTotals?.value === true && allRows.length > 0;
    const configuredRowH = configuredRowHeight(ctx);
    const minRowH = configuredRowH || fontSize + 6;
    const initialBodyH = Math.max(0, height - headerH);
    const needsOverflowNotice = allRows.length + (showTotals ? 1 : 0) > Math.max(1, Math.floor(initialBodyH / minRowH));
    const overflowH = needsOverflowNotice ? fontSize + 7 : 0;
    const bodyH = Math.max(0, initialBodyH - overflowH);
    const visibleCount = Math.max(1, Math.floor(bodyH / minRowH) - (showTotals ? 1 : 0));
    const rows = allRows.slice(0, visibleCount);
    const hiddenCount = allRows.length - rows.length;
    // Fill mode (rowHeight = 0): rows divide the whole body height evenly.
    const rowH = configuredRowH || Math.max(1, bodyH / (rows.length + (showTotals ? 1 : 0)));
    const showGridlines = settings.gridlines?.show?.value !== false;

    const configuredLabelW = settings.notation.labelWidth.value;
    const maxLabelPx = d3.max(rows, (r) => measureText(r.label, fontSize)) ?? 0;
    const maxLabelW = Math.max(28, width * 0.4);
    const labelW = configuredLabelW > 0
        ? clamp(configuredLabelW, 28, maxLabelW)
        : clamp(maxLabelPx + 16, 28, maxLabelW);

    const minimumNumericW = 44;
    const availableNumericW = Math.max(0, width - labelW - 8);
    let numericCount = 1 + (showBase ? 1 : 0) + (showAbs ? 1 : 0) + (showPct ? 1 : 0);
    if (showPct && availableNumericW / numericCount < minimumNumericW) {
        showPct = false;
        numericCount--;
    }
    if (showAbs && availableNumericW / numericCount < minimumNumericW) {
        showAbs = false;
        numericCount--;
    }
    if (showBase && availableNumericW / numericCount < 32) {
        showBase = false;
        numericCount--;
    }

    interface ColDef {
        key: "base" | "ac" | "delta" | "pct";
        header: string;
        width: number;
        x: number;
    }
    const numericW = availableNumericW / Math.max(1, numericCount);
    const cols: ColDef[] = [];
    let cursor = labelW;
    if (showBase) {
        cols.push({ key: "base", header: baseKind as string, width: numericW, x: cursor });
        cursor += numericW;
    }
    cols.push({ key: "ac", header: "AC", width: numericW, x: cursor });
    cursor += numericW;
    if (showAbs) {
        cols.push({ key: "delta", header: `\u0394${baseKind}`, width: numericW, x: cursor });
        cursor += numericW;
    }
    if (showPct) {
        cols.push({ key: "pct", header: `\u0394${baseKind}%`, width: numericW, x: cursor });
    }

    // header row (ac / delta / pct headers are clickable for Zebra-style sorting)
    const keyToSort: Record<ColDef["key"], SortField | null> = { base: null, ac: "ac", delta: "delta", pct: "deltaPct" };
    const header = svg
        .selectAll<SVGGElement, unknown>("g.ibcs-thead")
        .data([null]);
    const headerMerged = header
        .enter()
        .append("g")
        .attr("class", "ibcs-thead")
        .merge(header);
    headerMerged
        .selectAll<SVGTextElement, ColDef>("text")
        .data(cols, (c) => c.key)
        .join((enter) => enter.append("text"))
        .attr("x", (c) => c.x + c.width - 8)
        .attr("y", headerH - 6)
        .attr("text-anchor", "end")
        .attr("font-size", fontSize - 1)
        .attr("font-weight", 600)
        .attr("fill", colors.outline)
        .attr("tabindex", (c) => (ctx.allowInteractions && keyToSort[c.key] ? 0 : null))
        .attr("role", (c) => (keyToSort[c.key] ? "button" : null))
        .attr("aria-label", (c) => c.header)
        .style("cursor", (c) => (keyToSort[c.key] ? "pointer" : "default"))
        .text((c) => {
            const sf = keyToSort[c.key];

            return c.header + (sf ? sortArrow(ctx, sf) : "");
        })
        .on("click", (event: MouseEvent, c) => {
            const sf = keyToSort[c.key];
            if (!sf) {
                return;
            }
            event.stopPropagation();
            cycleSort(ctx, sf);
        })
        .on("keydown", (event: KeyboardEvent, c) => {
            const sf = keyToSort[c.key];
            if (!sf || (event.key !== "Enter" && event.key !== " ")) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            cycleSort(ctx, sf);
        });
    const rule = headerMerged
        .selectAll<SVGLineElement, unknown>("line.ibcs-thead-rule")
        .data([null]);
    rule
        .enter()
        .append("line")
        .attr("class", "ibcs-thead-rule")
        .merge(rule)
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", headerH - 1)
        .attr("y2", headerH - 1)
        .attr("stroke", colors.outline)
        .attr("stroke-width", 0.75);

    const body = svg
        .selectAll<SVGGElement, unknown>("g.ibcs-tbody")
        .data([null]);
    const bodyMerged = body
        .enter()
        .append("g")
        .attr("class", "ibcs-tbody")
        .merge(body);
    bodyMerged.attr("transform", `translate(0, ${headerH})`);

    const rowSel = bodyMerged
        .selectAll<SVGGElement, TableModel["rows"][number]>("g.ibcs-trow")
        .data(rows, (d, i) => dataPointKey(d.label, d.selectionId, i))
        .join((enter) => {
            const g = enter.append("g").attr("class", "ibcs-trow");
            g.append("rect").attr("class", "ibcs-hit").attr("fill", "transparent");
            g.append("text").attr("class", "ibcs-tlabel");

            return g;
        })
        .each(function (d, i) {
            tween(ctx, d3.select(this)).attr("transform", `translate(0, ${i * rowH})`);
            d3.select(this).attr("data-label", d.label);
        });

    // Drop cells for columns the current width no longer shows.
    for (const key of ["base", "delta", "pct"] as const) {
        if (!cols.some((c) => c.key === key)) {
            rowSel.selectAll(`.ibcs-cell-${key}`).remove();
        }
    }

    // hairlines
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

    // labels
    rowSel
        .select<SVGTextElement>("text.ibcs-tlabel")
        .attr("x", 4)
        .attr("y", rowH / 2)
        .attr("dy", "0.35em")
        .attr("font-size", fontSize)
        .attr("fill", colors.text)
        .attr("opacity", (d) => dataPointOpacity(ctx, d.selectionId, d.highlighted))
        .text((d) => truncateText(d.label, labelW - 12, fontSize));

    const valueText = (
        key: ColDef["key"],
        d: Pick<TableModel["rows"][number], "ac" | "base" | "delta" | "deltaPct">
    ): string | null => {
        switch (key) {
            case "base":
                return d.base !== null ? formatter(d.base) : null;
            case "ac":
                return d.ac !== null ? formatter(d.ac) : null;
            case "delta":
                return d.delta !== null ? formatSigned(formatter, d.delta) : null;
            case "pct":
                return d.deltaPct !== null ? formatSignedPercent(d.deltaPct) : null;
            default:
                return null;
        }
    };

    rowSel.each(function (d) {
        const row = d3.select(this);
        for (const col of cols) {
            const isVariance = col.key === "delta" || col.key === "pct";
            const delta = col.key === "delta" ? d.delta : d.deltaPct;
            const fill = col.key === "base"
                ? colors.outline
                : isVariance && delta !== null
                    ? varianceColor(delta, goodDirection, colorMode, colors)
                    : colors.text;
            ensureChild<SVGTextElement>(row, `.ibcs-cell-${col.key}`, "text", `ibcs-cell-${col.key}`)
                .attr("x", col.x + col.width - 8)
                .attr("y", rowH / 2)
                .attr("dy", "0.35em")
                .attr("text-anchor", "end")
                .attr("font-size", fontSize)
                .style("font-variant-numeric", "tabular-nums")
                .attr("fill", fill)
                .attr("opacity", dataPointOpacity(ctx, d.selectionId, d.highlighted))
                .text(valueText(col.key, d) ?? "");
        }
    });

    // Hit areas must be behind the text. A transparent SVG fill still
    // participates in painting/hit-testing and Power BI can composite it over
    // the values, especially after a formatting-pane update.
    rowSel
        .select<SVGRectElement>("rect.ibcs-hit")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", rowH)
        .each(function (d) {
            const items = (): TooltipItem[] => {
                const list: TooltipItem[] = [];
                if (showBase && d.base !== null) {
                    list.push({ displayName: model.baseLabel, value: formatter(d.base) });
                }
                if (d.ac !== null) {
                    list.push({ displayName: "AC", value: formatter(d.ac) });
                }
                if (d.delta !== null) {
                    list.push({ displayName: `\u0394${baseKind}`, value: formatSigned(formatter, d.delta) });
                }
                if (d.deltaPct !== null) {
                    list.push({ displayName: `\u0394${baseKind}%`, value: formatSignedPercent(d.deltaPct) });
                }

                return list.concat(d.tooltipExtra);
            };
            bindInteractions(ctx, d3.select(this), () => d.selectionIds ?? d.selectionId, items);
        });

    // --- totals row (aggregated, tooltip-only, never selectable) ---
    const totalsSel = bodyMerged
        .selectAll<SVGGElement, Totals>("g.ibcs-ttotal")
        .data(showTotals ? [computeTotals(allRows)] : []);
    totalsSel.exit().remove();
    const totalsMerged = totalsSel
        .enter()
        .append("g")
        .attr("class", "ibcs-ttotal")
        .merge(totalsSel);
    if (showTotals) {
        const t = computeTotals(allRows);
        const opacity = totalsOpacity(ctx, allRows.some((r) => r.highlighted));
        totalsMerged.attr("transform", `translate(0, ${rows.length * rowH})`);

        ensureChild<SVGLineElement>(totalsMerged, ".ibcs-ttotal-rule", "line", "ibcs-ttotal-rule")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", colors.outline)
            .attr("stroke-width", 1.25);
        ensureChild<SVGTextElement>(totalsMerged, ".ibcs-ttotal-label", "text", "ibcs-ttotal-label")
            .attr("x", 4)
            .attr("y", rowH / 2)
            .attr("dy", "0.35em")
            .attr("font-size", fontSize)
            .attr("font-weight", 600)
            .attr("fill", colors.text)
            .attr("opacity", opacity)
            .text(ctx.localization.getDisplayName("Visual_Total"));

        for (const col of cols) {
            const isVariance = col.key === "delta" || col.key === "pct";
            const delta = col.key === "delta" ? t.delta : t.deltaPct;
            const fill = col.key === "base"
                ? colors.outline
                : isVariance && delta !== null
                    ? varianceColor(delta, goodDirection, colorMode, colors)
                    : colors.text;
            ensureChild<SVGTextElement>(totalsMerged, `.ibcs-tcell-${col.key}`, "text", `ibcs-tcell-${col.key}`)
                .attr("x", col.x + col.width - 8)
                .attr("y", rowH / 2)
                .attr("dy", "0.35em")
                .attr("text-anchor", "end")
                .attr("font-size", fontSize)
                .attr("font-weight", 600)
                .style("font-variant-numeric", "tabular-nums")
                .attr("fill", fill)
                .attr("opacity", opacity)
                .text(valueText(col.key, t) ?? "");
        }
        for (const key of ["base", "delta", "pct"] as const) {
            if (!cols.some((c) => c.key === key)) {
                totalsMerged.select(`.ibcs-tcell-${key}`).remove();
            }
        }

        ensureChild<SVGRectElement>(totalsMerged, ".ibcs-hit", "rect", "ibcs-hit")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", width)
            .attr("height", rowH)
            .attr("fill", "transparent")
            .each(function () {
                const items = (): TooltipItem[] => {
                    const list: TooltipItem[] = [];
                    if (showBase && t.base !== null) {
                        list.push({ displayName: model.baseLabel, value: formatter(t.base) });
                    }
                    if (t.ac !== null) {
                        list.push({ displayName: "AC", value: formatter(t.ac) });
                    }
                    if (t.delta !== null) {
                        list.push({ displayName: `\u0394${baseKind}`, value: formatSigned(formatter, t.delta) });
                    }
                    if (t.deltaPct !== null) {
                        list.push({ displayName: `\u0394${baseKind}%`, value: formatSignedPercent(t.deltaPct) });
                    }

                    return list;
                };
                bindInteractions(ctx, d3.select(this), () => nonSelectableId(), items);
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
