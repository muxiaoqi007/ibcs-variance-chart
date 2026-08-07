// Shared render context passed to all chart renderers.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";
import { NotationColors } from "../ibcs";
import { VisualFormattingSettingsModel } from "../settings";
import { Formatter } from "../helpers";

export type ChartMode = "variance" | "timeseries" | "waterfall" | "table";

export interface RenderContext {
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    width: number;
    height: number;
    host: powerbi.extensibility.visual.IVisualHost;
    settings: VisualFormattingSettingsModel;
    colors: NotationColors;
    /** Value formatter honoring the display-units setting. */
    formatter: Formatter;
    fontSize: number;
    selectionManager: powerbi.extensibility.ISelectionManager;
    allowInteractions: boolean;
    tooltip: ITooltipServiceWrapper;
    localization: powerbi.extensibility.ILocalizationManager;
    /** Trigger a redraw after selection state changed. */
    onInteraction: () => void;
}

export function selectionOpacity(ctx: RenderContext, id: powerbi.visuals.ISelectionId): number {
    if (!ctx.allowInteractions) {
        return 1;
    }
    if (!ctx.selectionManager.hasSelection()) {
        return 1;
    }
    const selected = ctx.selectionManager.getSelectionIds() as powerbi.visuals.ISelectionId[];

    return selected.some((s) => s.equals(id)) ? 1 : 0.35;
}

export interface TooltipItem {
    displayName: string;
    value: string;
}

export function bindInteractions(
    ctx: RenderContext,
    sel: d3.Selection<any, any, any, unknown>,
    id: () => powerbi.visuals.ISelectionId,
    tooltipItems: () => TooltipItem[]
): void {
    sel.style("cursor", ctx.allowInteractions ? "pointer" : "default");

    // The tooltip wrapper binds pointerover/pointerout/pointermove itself.
    ctx.tooltip.addTooltip(
        sel,
        () => tooltipItems(),
        () => id(),
        false
    );

    sel
        .on("click", (event: MouseEvent) => {
            if (!ctx.allowInteractions) {
                return;
            }
            event.stopPropagation();
            ctx.selectionManager.select(id(), event.ctrlKey).then(() => {
                ctx.onInteraction();
            });
        })
        .on("contextmenu", (event: MouseEvent) => {
            if (!ctx.allowInteractions) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            ctx.selectionManager.showContextMenu(id(), {
                x: event.clientX,
                y: event.clientY
            });
        });
}

/** Clamp helper. */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export type SortField = "ac" | "delta" | "deltaPct";

/**
 * Zebra-BI-style header click sorting: clicking the same column toggles
 * descending/ascending, clicking another column starts descending.
 * The choice is persisted through the sortSettings formatting object.
 */
export function cycleSort(ctx: RenderContext, clicked: SortField): void {
    const currentField = String(ctx.settings.sortSettings.field.value ?? "none");
    const currentDirection = String(ctx.settings.sortSettings.direction.value ?? "desc");
    const direction = currentField === clicked && currentDirection === "desc" ? "asc" : "desc";
    ctx.host.persistProperties({
        merge: [
            {
                selector: null,
                objectName: "sortSettings",
                properties: {
                    field: clicked,
                    direction
                }
            }
        ]
    });
}

/** Arrow suffix for the actively sorted column header. */
export function sortArrow(ctx: RenderContext, field: SortField): string {
    const currentField = String(ctx.settings.sortSettings.field.value ?? "none");
    if (currentField !== field) {
        return "";
    }
    const currentDirection = String(ctx.settings.sortSettings.direction.value ?? "desc");

    return currentDirection === "desc" ? " \u2193" : " \u2191";
}
