// IBCS Charts - IBCS-style chart suite for Power BI (Zebra BI inspired).
// Modern API: getFormattingModel + rendering events. apiVersion 5.9.0.

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";

import IVisual = powerbi.extensibility.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbi.DataView;
import FormattingModel = powerbi.visuals.FormattingModel;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { createTooltipServiceWrapper, ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";

import { VisualFormattingSettingsModel } from "./settings";
import { DEFAULT_COLORS, NotationColors, ScenarioKind } from "./ibcs";
import { parseDataView, ParseOutput, resolveBaseScenario } from "./dataModel";
import { createFormatter, Formatter, isNumeric } from "./helpers";
import { RenderContext, ChartMode, TooltipItem, clamp } from "./renderers/common";
import { renderVarianceChart, VarianceModel } from "./renderers/varianceChart";
import { renderTimeSeries, TimeSeriesModel } from "./renderers/timeSeries";
import { renderWaterfall, WaterfallModel, WaterfallColumn } from "./renderers/waterfall";
import { renderTable, TableModel } from "./renderers/table";

import "../style/visual.less";

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private localizationManager: ILocalizationManager;
    private formattingSettingsService: FormattingSettingsService;
    private formattingModel: VisualFormattingSettingsModel;
    private tooltipService: ITooltipServiceWrapper;
    private allowInteractions: boolean;

    private root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;

    private lastViewport: { width: number; height: number } | null = null;
    private lastRender: (() => void) | null = null;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = this.host.createSelectionManager();
        this.localizationManager = this.host.createLocalizationManager();
        this.formattingSettingsService = new FormattingSettingsService(this.localizationManager);
        this.formattingModel = new VisualFormattingSettingsModel();
        this.tooltipService = createTooltipServiceWrapper(this.host.tooltipService, options.element as HTMLElement);
        this.allowInteractions = this.host.hostCapabilities?.allowInteractions ?? true;

        this.root = d3.select(options.element as HTMLDivElement).classed("ibcsCharts", true);
        this.svg = this.root.append("svg");

        this.svg.on("click", () => {
            if (this.selectionManager.hasSelection()) {
                this.selectionManager.clear().then(() => {
                    this.redraw();
                });
            }
        });
        this.svg.on("contextmenu", (event: MouseEvent) => {
            event.preventDefault();
            this.selectionManager.showContextMenu({}, { x: event.clientX, y: event.clientY });
        });
    }

    public update(options: VisualUpdateOptions): void {
        const { width, height } = options.viewport;
        if (width < 60 || height < 40) {
            return;
        }
        this.events.renderingStarted(options);
        try {
            this.lastViewport = { width, height };
            const dataView: DataView | undefined = options.dataViews?.[0];
            if (dataView) {
                this.formattingModel = this.formattingSettingsService.populateFormattingSettingsModel(
                    VisualFormattingSettingsModel,
                    dataView
                );
            }

            const parsed = parseDataView(dataView, this.host);
            if (!parsed) {
                this.renderLandingPage(width, height);
                this.lastRender = null;
                this.events.renderingFinished(options);

                return;
            }

            this.lastRender = () => this.renderParsed(parsed, width, height);
            this.lastRender();
            this.events.renderingFinished(options);
        } catch (error) {
            this.renderError(width, height, (error as Error).message);
            this.events.renderingFailed(options, (error as Error).message);
        }
    }

    public getFormattingModel(): FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingModel);
    }

    // ------------------------------------------------------------------

    private redraw(): void {
        if (this.lastRender) {
            this.lastRender();
        }
    }

    private getColor(fill: unknown, fallback: string): string {
        const value = (fill as { value?: string })?.value;

        return typeof value === "string" && value ? value : fallback;
    }

    private resolveColors(): NotationColors {
        return {
            ...DEFAULT_COLORS,
            ac: this.getColor(this.formattingModel.notation.acColor.value, DEFAULT_COLORS.ac),
            outline: this.getColor(this.formattingModel.notation.outlineColor.value, DEFAULT_COLORS.outline),
            positive: this.getColor(this.formattingModel.variance.positiveColor.value, DEFAULT_COLORS.positive),
            negative: this.getColor(this.formattingModel.variance.negativeColor.value, DEFAULT_COLORS.negative)
        };
    }

    private renderParsed(parsed: ParseOutput, width: number, height: number): void {
        this.svg.selectAll("*").remove();
        this.svg
            .attr("width", width)
            .attr("height", height)
            .attr("role", "img")
            .attr("aria-label", this.localizationManager.getDisplayName("Visual_AriaDescription"));

        const hasRows = parsed.rows.length > 0 || (parsed.timeRows?.length ?? 0) > 0;
        if (!hasRows) {
            this.renderNoRows(width, height);
            return;
        }

        const settings = this.formattingModel;
        const colors = this.resolveColors();
        const fontSize = clamp(settings.labels.fontSize.value || 11, 8, 24);
        const mode = (settings.chart.mode.value as ChartMode) || "variance";
        const baseKind = resolveBaseScenario(String(settings.scenarios.baseScenario.value), parsed.present);
        const baseLabel = (baseKind && parsed.scenarioDisplay[baseKind]) || baseKind || "";

        // Zebra-BI-style sorting (persisted via header clicks / formatting pane).
        const sortedRows = this.sortRows(
            parsed.rows,
            baseKind,
            String(settings.sortSettings.field.value ?? "none"),
            String(settings.sortSettings.direction.value ?? "desc")
        );
        const rowsParsed: ParseOutput = { ...parsed, rows: sortedRows };

        // Formatter sized for automatic display units.
        let maxAbs = 0;
        const scan = (values: Partial<Record<ScenarioKind, number>>): void => {
            for (const v of Object.values(values)) {
                if (isNumeric(v) && Math.abs(v) > maxAbs) {
                    maxAbs = Math.abs(v);
                }
            }
        };
        parsed.rows.forEach((r) => scan(r.values));
        parsed.timeRows?.forEach((r) => scan(r.values));
        const displayUnits = parseFloat(String(settings.labels.displayUnits.value)) || 0;
        const formatter: Formatter = createFormatter({
            format: parsed.valueFormat,
            displayUnits,
            maxValue: maxAbs
        });

        const tooltipFormatters = parsed.tooltipFields.map((f) =>
            createFormatter({ format: f.format, displayUnits, maxValue: maxAbs })
        );
        const buildTooltipExtra = (raw: Array<number | null>): TooltipItem[] => {
            const items: TooltipItem[] = [];
            parsed.tooltipFields.forEach((f, idx) => {
                const value = raw[idx];
                if (isNumeric(value)) {
                    items.push({ displayName: f.name, value: tooltipFormatters[idx](value) });
                }
            });

            return items;
        };

        const ctx: RenderContext = {
            svg: this.svg,
            width,
            height,
            host: this.host,
            settings,
            colors,
            formatter,
            fontSize,
            selectionManager: this.selectionManager,
            allowInteractions: this.allowInteractions,
            tooltip: this.tooltipService,
            localization: this.localizationManager,
            onInteraction: () => this.redraw()
        };

        switch (mode) {
            case "timeseries":
                this.renderTimeSeriesMode(ctx, parsed, baseKind, baseLabel, buildTooltipExtra);
                break;
            case "waterfall":
                this.renderWaterfallMode(ctx, parsed, baseKind, baseLabel, buildTooltipExtra);
                break;
            case "table":
                this.renderTableMode(ctx, rowsParsed, baseKind, baseLabel, buildTooltipExtra);
                break;
            case "variance":
            default:
                this.renderVarianceMode(ctx, rowsParsed, baseKind, baseLabel, buildTooltipExtra);
                break;
        }
    }

    private sortRows(
        rows: ParseOutput["rows"],
        baseKind: ScenarioKind | null,
        field: string,
        direction: string
    ): ParseOutput["rows"] {
        if (field === "none" || field === "undefined") {
            return rows;
        }
        const metric = (r: ParseOutput["rows"][number]): number | null => {
            const ac = r.values.AC;
            if (field === "ac") {
                return ac ?? null;
            }
            const base = baseKind ? r.values[baseKind] : undefined;
            if (ac === undefined || base === undefined) {
                return null;
            }
            const delta = ac - base;

            return field === "delta" ? delta : base !== 0 ? delta / base : null;
        };
        const sorted = [...rows];
        sorted.sort((a, b) => {
            const va = metric(a);
            const vb = metric(b);
            if (va === null && vb === null) {
                return 0;
            }
            if (va === null) {
                return 1;
            }
            if (vb === null) {
                return -1;
            }

            return direction === "asc" ? va - vb : vb - va;
        });

        return sorted;
    }

    private renderVarianceMode(
        ctx: RenderContext,
        parsed: ParseOutput,
        baseKind: ScenarioKind | null,
        baseLabel: string,
        buildTooltipExtra: (raw: Array<number | null>) => TooltipItem[]
    ): void {
        const model: VarianceModel = {
            baseKind,
            baseLabel,
            rows: parsed.rows.map((r) => {
                const ac = r.values.AC ?? null;
                const base = baseKind ? r.values[baseKind] ?? null : null;
                const delta = ac !== null && base !== null ? ac - base : null;
                const deltaPct = delta !== null && base !== null && base !== 0 ? delta / base : null;

                return {
                    label: r.label,
                    selectionId: r.selectionId,
                    ac,
                    base,
                    delta,
                    deltaPct,
                    tooltipExtra: buildTooltipExtra(r.tooltipRaw)
                };
            })
        };
        renderVarianceChart(ctx, model);
    }

    private renderTimeSeriesMode(
        ctx: RenderContext,
        parsed: ParseOutput,
        _baseKind: ScenarioKind | null,
        _baseLabel: string,
        _buildTooltipExtra: (raw: Array<number | null>) => TooltipItem[]
    ): void {
        const source = parsed.timeRows ?? parsed.rows;
        const model: TimeSeriesModel = {
            present: parsed.present,
            scenarioDisplay: parsed.scenarioDisplay,
            points: source.map((r) => ({
                label: r.label,
                selectionId: r.selectionId,
                values: r.values,
                tooltipExtra: []
            }))
        };
        renderTimeSeries(ctx, model);
    }

    private renderWaterfallMode(
        ctx: RenderContext,
        parsed: ParseOutput,
        baseKind: ScenarioKind | null,
        _baseLabel: string,
        buildTooltipExtra: (raw: Array<number | null>) => TooltipItem[]
    ): void {
        const totalLabel = this.localizationManager.getDisplayName("Visual_Total");
        const columns: WaterfallColumn[] = [];
        const emptyId = () => this.host.createSelectionIdBuilder().createSelectionId();

        if (baseKind) {
            let baseTotal = 0;
            let acTotal = 0;
            const steps: WaterfallColumn[] = [];
            for (const r of parsed.rows) {
                const ac = r.values.AC;
                const base = r.values[baseKind];
                if (ac === undefined || base === undefined) {
                    continue;
                }
                baseTotal += base;
                acTotal += ac;
                steps.push({
                    type: "step",
                    label: r.label,
                    value: ac - base,
                    selectionId: r.selectionId,
                    tooltipExtra: buildTooltipExtra(r.tooltipRaw)
                });
            }
            columns.push({ type: "start", label: baseKind, value: baseTotal, selectionId: emptyId(), tooltipExtra: [] });
            columns.push(...steps);
            columns.push({ type: "end", label: "AC", value: acTotal, selectionId: emptyId(), tooltipExtra: [] });
        } else {
            let total = 0;
            for (const r of parsed.rows) {
                const ac = r.values.AC ?? r.values.UNKNOWN;
                if (ac === undefined) {
                    continue;
                }
                total += ac;
                columns.push({
                    type: "step",
                    label: r.label,
                    value: ac,
                    selectionId: r.selectionId,
                    tooltipExtra: buildTooltipExtra(r.tooltipRaw)
                });
            }
            columns.push({ type: "end", label: totalLabel, value: total, selectionId: emptyId(), tooltipExtra: [] });
        }

        const model: WaterfallModel = { columns, baseKind, totalLabel };
        renderWaterfall(ctx, model);
    }

    private renderTableMode(
        ctx: RenderContext,
        parsed: ParseOutput,
        baseKind: ScenarioKind | null,
        baseLabel: string,
        buildTooltipExtra: (raw: Array<number | null>) => TooltipItem[]
    ): void {
        const model: TableModel = {
            baseKind,
            baseLabel,
            rows: parsed.rows.map((r) => {
                const ac = r.values.AC ?? null;
                const base = baseKind ? r.values[baseKind] ?? null : null;
                const delta = ac !== null && base !== null ? ac - base : null;
                const deltaPct = delta !== null && base !== null && base !== 0 ? delta / base : null;

                return {
                    label: r.label,
                    selectionId: r.selectionId,
                    ac,
                    base,
                    delta,
                    deltaPct,
                    tooltipExtra: buildTooltipExtra(r.tooltipRaw)
                };
            })
        };
        renderTable(ctx, model);
    }

    private renderNoRows(width: number, height: number): void {
        this.svg.selectAll("*").remove();
        this.svg.attr("width", width).attr("height", height);
        const g = this.svg.append("g");
        g.append("text")
            .attr("class", "ibcs-landing-title")
            .attr("x", width / 2)
            .attr("y", height / 2 - 14)
            .attr("text-anchor", "middle")
            .text(this.localizationManager.getDisplayName("Visual_NoRowsTitle"));
        g.append("text")
            .attr("class", "ibcs-landing-body")
            .attr("x", width / 2)
            .attr("y", height / 2 + 10)
            .attr("text-anchor", "middle")
            .text(this.localizationManager.getDisplayName("Visual_NoRowsBody"));
    }

    private renderError(width: number, height: number, message: string): void {
        this.svg.selectAll("*").remove();
        this.svg.attr("width", width).attr("height", height);
        const g = this.svg.append("g");
        g.append("text")
            .attr("class", "ibcs-landing-title")
            .attr("x", width / 2)
            .attr("y", height / 2 - 14)
            .attr("text-anchor", "middle")
            .attr("fill", "#D13438")
            .text("Render error");
        g.append("text")
            .attr("class", "ibcs-landing-body")
            .attr("x", width / 2)
            .attr("y", height / 2 + 10)
            .attr("text-anchor", "middle")
            .text(message.length > 100 ? `${message.slice(0, 97)}…` : message);
    }

    private renderLandingPage(width: number, height: number): void {
        this.svg.selectAll("*").remove();
        this.svg.attr("width", width).attr("height", height);
        const title = this.localizationManager.getDisplayName("Visual_LandingTitle");
        const body = this.localizationManager.getDisplayName("Visual_LandingBody");

        const g = this.svg.append("g");
        g.append("text")
            .attr("class", "ibcs-landing-title")
            .attr("x", width / 2)
            .attr("y", height / 2 - 14)
            .attr("text-anchor", "middle")
            .text(title);
        g.append("text")
            .attr("class", "ibcs-landing-body")
            .attr("x", width / 2)
            .attr("y", height / 2 + 10)
            .attr("text-anchor", "middle")
            .text(body.length > 80 ? `${body.slice(0, 77)}…` : body);
    }
}
