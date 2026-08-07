// IBCS semantic table: right-aligned figures, scenario abbreviation headers,
// green/red variance figures following the good-direction setting.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ScenarioKind, varianceColor } from "../ibcs";
import { formatSigned, formatSignedPercent, measureText, truncateText } from "../helpers";
import { RenderContext, bindInteractions, selectionOpacity, TooltipItem, clamp, cycleSort, sortArrow, SortField } from "./common";

export interface TableModel {
    rows: Array<{
        label: string;
        selectionId: powerbi.visuals.ISelectionId;
        ac: number | null;
        base: number | null;
        delta: number | null;
        deltaPct: number | null;
        tooltipExtra: TooltipItem[];
    }>;
    baseKind: ScenarioKind | null;
    baseLabel: string;
}

export function renderTable(ctx: RenderContext, model: TableModel): void {
    const { svg, width, height, colors, settings, formatter, fontSize } = ctx;

    const rows = model.rows;
    if (rows.length === 0) {
        return;
    }
    const baseKind = model.baseKind;
    const showBase = baseKind !== null;
    const showAbs = settings.variance.showDeltaAbs.value && showBase;
    const showPct = settings.variance.showDeltaPct.value && showBase;
    const colorMode = settings.variance.colorMode.value as "semantic" | "neutral";
    const goodDirection = settings.variance.goodDirection.value as "up" | "down";

    const headerH = fontSize + 12;
    const bodyH = height - headerH;
    const rowH = clamp(bodyH / rows.length, fontSize + 6, 30);

    const configuredLabelW = settings.notation.labelWidth.value;
    const maxLabelPx = d3.max(rows, (r) => measureText(r.label, fontSize)) ?? 0;
    const labelW = configuredLabelW > 0
        ? Math.min(configuredLabelW, width * 0.6)
        : clamp(maxLabelPx + 16, 60, width * 0.4);

    interface ColDef {
        key: "base" | "ac" | "delta" | "pct";
        header: string;
        width: number;
        x: number;
    }
    const numericCount = 1 + (showBase ? 1 : 0) + (showAbs ? 1 : 0) + (showPct ? 1 : 0);
    const numericW = Math.max(56, (width - labelW - 8) / numericCount);
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
        cursor += numericW;
    }

    // header row (ac / delta / pct headers are clickable for Zebra-style sorting)
    const keyToSort: Record<ColDef["key"], SortField | null> = { base: null, ac: "ac", delta: "delta", pct: "deltaPct" };
    const header = svg.append("g");
    header
        .selectAll("text")
        .data(cols)
        .enter()
        .append("text")
        .attr("x", (c) => c.x + c.width - 8)
        .attr("y", headerH - 6)
        .attr("text-anchor", "end")
        .attr("font-size", fontSize - 1)
        .attr("font-weight", 600)
        .attr("fill", "#767676")
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
        });
    header
        .append("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", headerH - 1)
        .attr("y2", headerH - 1)
        .attr("stroke", colors.outline)
        .attr("stroke-width", 0.75);

    const body = svg.append("g").attr("transform", `translate(0, ${headerH})`);
    const rowSel = body
        .selectAll("g.ibcs-trow")
        .data(rows)
        .enter()
        .append("g")
        .attr("class", "ibcs-trow")
        .attr("transform", (_d, i) => `translate(0, ${i * rowH})`);

    // hairlines
    rowSel
        .filter((_d, i) => i > 0)
        .append("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", 0)
        .attr("y2", 0)
        .attr("stroke", "#ECECEC")
        .attr("stroke-width", 1);

    // labels
    rowSel
        .append("text")
        .attr("x", 4)
        .attr("y", rowH / 2)
        .attr("dy", "0.35em")
        .attr("font-size", fontSize)
        .attr("fill", colors.text)
        .attr("opacity", (d) => selectionOpacity(ctx, d.selectionId))
        .text((d) => truncateText(d.label, labelW - 12, fontSize));

    const valueText = (
        key: ColDef["key"],
        d: TableModel["rows"][number]
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

    for (const col of cols) {
        const isVariance = col.key === "delta" || col.key === "pct";
        rowSel
            .append("text")
            .attr("x", col.x + col.width - 8)
            .attr("y", rowH / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("font-size", fontSize)
            .style("font-variant-numeric", "tabular-nums")
            .attr("fill", (d) => {
                if (col.key === "base") {
                    return colors.outline;
                }
                if (!isVariance) {
                    return colors.text;
                }
                const delta = col.key === "delta" ? d.delta : d.deltaPct;

                return delta === null ? colors.text : varianceColor(delta, goodDirection, colorMode, colors);
            })
            .attr("opacity", (d) => selectionOpacity(ctx, d.selectionId))
            .text((d) => valueText(col.key, d) ?? "");
    }

    // hit areas for tooltips and selection
    rowSel
        .append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", rowH)
        .attr("fill", "transparent")
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
            bindInteractions(ctx, d3.select(this), () => d.selectionId, items);
        });
}
