// Shared render context passed to all chart renderers.

import * as d3 from "d3";
import powerbi from "powerbi-visuals-api";
import { ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";
import { NotationColors } from "../ibcs";
import { VisualFormattingSettingsModel } from "../settings";
import { Formatter } from "../helpers";

export type ChartMode = "variance" | "vertical" | "timeseries" | "waterfall" | "table";

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
    /** Animate geometry changes (disabled for resize and test harnesses). */
    animate: boolean;
    /** True when Power BI delivered highlight values for this update. */
    highlightActive: boolean;
}

/** Resolve the user-configured row height. Zero/missing means auto-fit. */
export function configuredRowHeight(ctx: RenderContext): number {
    const raw = Number(ctx.settings.notation?.rowHeight?.value);

    return Number.isFinite(raw) && raw > 0 ? clamp(raw, 14, 60) : 0;
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

/** Combined selection + cross-visual highlight opacity for a data point. */
export function dataPointOpacity(
    ctx: RenderContext,
    id: powerbi.visuals.ISelectionId,
    highlighted: boolean
): number {
    const dimmed = ctx.highlightActive && !highlighted;

    return selectionOpacity(ctx, id) * (dimmed ? 0.35 : 1);
}

/**
 * Stable DOM key for a rendered row. Falls back to the label when the host
 * selection id cannot provide a key (test harnesses).
 */
export function dataPointKey(
    label: string,
    id: powerbi.visuals.ISelectionId | undefined,
    index: number
): string {
    const idKey = id?.getKey?.();

    return `${index}::${typeof idKey === "string" && idKey ? idKey : label}`;
}

/**
 * Apply attributes either immediately or through a short transition.
 * Resize/test renders pass animate=false so final geometry is synchronous.
 */
export function tween(
    ctx: RenderContext,
    sel: d3.Selection<any, any, any, unknown>,
    duration = 220
): d3.Selection<any, any, any, unknown> | d3.Transition<any, any, any, unknown> {
    return ctx.animate ? sel.transition().duration(duration).ease(d3.easeCubicOut) : sel;
}

/**
 * Select a single child element by selector, creating it with the given tag
 * and class when missing. The returned selection carries the parent's datum,
 * so keyed-join children can be updated in place.
 */
export function ensureChild<SN extends Element>(
    parent: d3.Selection<any, any, any, unknown>,
    selector: string,
    tag: string,
    cls: string
): d3.Selection<SN, any, any, unknown> {
    const existing = parent.select<SN>(selector);
    if (!existing.empty()) {
        return existing;
    }

    return parent.append<SN>(tag).attr("class", cls);
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

export interface Totals {
    ac: number | null;
    base: number | null;
    delta: number | null;
    deltaPct: number | null;
}

/**
 * Aggregate a totals row over the given rows. AC and base sum independently
 * over their non-null values; the variance is derived from the two sums,
 * which is how IBCS report totals are stated.
 */
export function computeTotals(rows: Array<{ ac: number | null; base: number | null }>): Totals {
    let ac = 0;
    let base = 0;
    let hasAc = false;
    let hasBase = false;
    for (const r of rows) {
        if (r.ac !== null) {
            ac += r.ac;
            hasAc = true;
        }
        if (r.base !== null) {
            base += r.base;
            hasBase = true;
        }
    }

    return {
        ac: hasAc ? ac : null,
        base: hasBase ? base : null,
        delta: hasAc && hasBase ? ac - base : null,
        deltaPct: hasAc && hasBase && base !== 0 ? (ac - base) / base : null
    };
}

/**
 * Highlight opacity for a totals row: dimmed only when a cross-visual
 * highlight is active and none of the underlying rows is highlighted.
 */
export function totalsOpacity(ctx: RenderContext, anyHighlighted: boolean): number {
    return ctx.highlightActive && !anyHighlighted ? 0.35 : 1;
}

/**
 * A non-identity selection id: totals rows expose tooltips but no selection.
 */
export function nonSelectableId(): powerbi.visuals.ISelectionId {
    return {} as powerbi.visuals.ISelectionId;
}

/**
 * Detect a magnifying-glass cut-off for outlier values (per-element scaling):
 * when the largest positive value dwarfs the runner-up, everything above the
 * returned limit is drawn truncated at the limit with a break mark. Returns
 * Infinity when scaling should not engage (disabled, too few values, or no
 * dominant outlier).
 */
export function detectOutlierLimit(
    values: Array<number | null>,
    enabled: boolean,
    ratio = 3,
    minRows = 3,
    headroom = 1.15
): number {
    if (!enabled) {
        return Infinity;
    }
    const sorted = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => b - a);
    if (sorted.length < minRows || sorted[1] <= 0) {
        return Infinity;
    }

    return sorted[0] / sorted[1] > ratio ? sorted[1] * headroom : Infinity;
}

/** True when the value is truncated by the outlier limit. */
export function isOutlierValue(value: number | null, limit: number): boolean {
    return value !== null && value > limit;
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
