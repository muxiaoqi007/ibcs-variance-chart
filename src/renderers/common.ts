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

export type SelectionTarget = powerbi.visuals.ISelectionId | powerbi.visuals.ISelectionId[];

export function bindInteractions(
    ctx: RenderContext,
    sel: d3.Selection<any, any, any, unknown>,
    id: () => SelectionTarget,
    tooltipItems: () => TooltipItem[]
): void {
    const validIds = (): powerbi.visuals.ISelectionId[] => {
        const target = id();

        return (Array.isArray(target) ? target : [target]).filter((item) => item?.hasIdentity?.());
    };
    const canSelect = ctx.allowInteractions && validIds().length > 0;
    sel.style("cursor", canSelect ? "pointer" : "default");
    sel
        .attr("tabindex", canSelect ? 0 : null)
        .attr("role", canSelect ? "button" : "img")
        .attr("aria-label", () => tooltipItems().map((item) => `${item.displayName}: ${item.value}`).join(", "));

    // The tooltip wrapper binds pointerover/pointerout/pointermove itself.
    const tooltipIdentity = validIds()[0];
    if (tooltipIdentity) {
        ctx.tooltip.addTooltip(sel, () => tooltipItems(), () => tooltipIdentity, false);
    } else {
        ctx.tooltip.addTooltip(sel, () => tooltipItems(), undefined, false);
    }

    sel
        .on("click", (event: MouseEvent) => {
            const identities = validIds();
            if (!ctx.allowInteractions || identities.length === 0) {
                return;
            }
            event.stopPropagation();
            ctx.selectionManager.select(identities.length === 1 ? identities[0] : identities, event.ctrlKey).then(() => {
                ctx.onInteraction();
            });
        })
        .on("contextmenu", (event: MouseEvent) => {
            const identities = validIds();
            if (!ctx.allowInteractions) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (identities.length !== 1) {
                return;
            }
            ctx.selectionManager.showContextMenu(identities[0], {
                x: event.clientX,
                y: event.clientY
            });
        })
        .on("keydown", (event: KeyboardEvent) => {
            const identities = validIds();
            if (!ctx.allowInteractions || identities.length === 0) {
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                ctx.selectionManager.select(identities.length === 1 ? identities[0] : identities, event.ctrlKey).then(() => ctx.onInteraction());
            } else if (event.key === "F10" && event.shiftKey && identities.length === 1) {
                event.preventDefault();
                event.stopPropagation();
                const target = event.currentTarget as Element;
                const bounds = target.getBoundingClientRect();
                ctx.selectionManager.showContextMenu(identities[0], {
                    x: bounds.left + bounds.width / 2,
                    y: bounds.top + bounds.height / 2
                });
            }
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
