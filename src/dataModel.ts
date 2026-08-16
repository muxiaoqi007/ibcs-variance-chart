// DataView parsing: dual-mode scenario input.
// Mode 1 (dimension): Scenario grouping field + Value measure, pivoted per scenario.
// Mode 2 (measures): dedicated AC / PY / PL / FC measure wells.

import powerbi from "powerbi-visuals-api";
import { detectScenario, ScenarioKind } from "./ibcs";
import { toNumber } from "./helpers";

export type ScenarioValues = Partial<Record<ScenarioKind, number>>;

export interface TooltipField {
    name: string;
    format?: string;
}

export interface CategoryRow {
    label: string;
    values: ScenarioValues;
    selectionId: powerbi.visuals.ISelectionId;
    /** Multiple source identities when this row is a synthetic aggregate. */
    selectionIds?: powerbi.visuals.ISelectionId[];
    tooltipRaw: Array<number | null>;
    firstRowIndex: number;
    /** Synthetic aggregate produced by Top N + Others. */
    isOthers?: boolean;
    /** True when any source record of this row is highlighted by another visual. */
    highlighted: boolean;
}

export interface TimeRow {
    label: string;
    values: ScenarioValues;
    selectionId: powerbi.visuals.ISelectionId;
    tooltipRaw: Array<number | null>;
    firstRowIndex: number;
    /** True when any source record of this time point is highlighted. */
    highlighted: boolean;
}

export type ScenarioSource = "dimension" | "measures";

export interface ParseOutput {
    /** Rows grouped by category (falls back to time labels when no category is bound). */
    rows: CategoryRow[];
    /** Rows grouped by time axis when the timeAxis role is bound. */
    timeRows: TimeRow[] | null;
    scenarioSource: ScenarioSource;
    /** Scenarios that have at least one value, in canonical order. */
    present: ScenarioKind[];
    /** First raw scenario label seen per kind (for legends). */
    scenarioDisplay: Partial<Record<ScenarioKind, string>>;
    valueFormat?: string;
    tooltipFields: TooltipField[];
    measureNames: Partial<Record<ScenarioKind, string>>;
    /** True when Power BI delivered highlight values (cross-visual selection active). */
    hasHighlight: boolean;
}

const CANON_ORDER: ScenarioKind[] = ["PY", "PL", "FC", "AC", "UNKNOWN"];

export function parseDataView(
    dataView: powerbi.DataView | undefined,
    host: powerbi.extensibility.visual.IVisualHost
): ParseOutput | null {
    const categorical = dataView?.categorical;
    if (!categorical) {
        return null;
    }
    const categories = categorical.categories ?? [];
    const values = categorical.values ?? [];

    const categoryCol = categories.find((c) => c.source.roles?.["category"]);
    const timeCol = categories.find((c) => c.source.roles?.["timeAxis"]);
    const scenarioCol = categories.find((c) => c.source.roles?.["scenario"]);
    const valueCol = values.find((v) => v.source.roles?.["value"]);
    const dedicated: Array<{ kind: ScenarioKind; col: powerbi.DataViewValueColumn }> = [];
    const roleKind: Array<[string, ScenarioKind]> = [
        ["ac", "AC"],
        ["py", "PY"],
        ["pl", "PL"],
        ["fc", "FC"]
    ];
    for (const [role, kind] of roleKind) {
        const col = values.find((v) => v.source.roles?.[role]);
        if (col) {
            dedicated.push({ kind, col });
        }
    }
    const tooltipCols = values.filter((v) => v.source.roles?.["tooltips"]);

    const hasDimension = !!scenarioCol && !!valueCol;
    const hasDedicated = dedicated.length > 0;
    if (!hasDimension && !hasDedicated) {
        return null;
    }

    // Cross-visual highlight: when another visual selects data, Power BI
    // delivers `highlights` next to the values (null for dimmed rows).
    const highlightsOf = (col: powerbi.DataViewValueColumn | undefined): Array<number | null> | null | undefined =>
        col ? (col as powerbi.DataViewValueColumn & { highlights?: Array<number | null> }).highlights : undefined;
    const valueHighlights = highlightsOf(valueCol);
    const dedicatedHighlights = new Map(dedicated.map(({ kind, col }) => [kind, highlightsOf(col)]));
    const highlightActive = hasDedicated
        ? [...dedicatedHighlights.values()].some((h) => h != null)
        : valueHighlights != null;
    const rowHighlighted = (i: number): boolean => {
        if (!highlightActive) {
            return false;
        }
        if (hasDedicated) {
            for (const h of dedicatedHighlights.values()) {
                if (h?.[i] != null) {
                    return true;
                }
            }

            return false;
        }

        return valueHighlights?.[i] != null;
    };

    const rowCount = (scenarioCol?.values.length
        ?? categoryCol?.values.length
        ?? timeCol?.values.length
        ?? values[0]?.values.length
        ?? 0);
    if (rowCount === 0) {
        return null;
    }

    // --- build leaf records ---
    interface Leaf {
        catLabel: string | null;
        timeLabel: string | null;
        kind: ScenarioKind;
        scenarioLabel: string | null;
        value: number;
        highlighted: boolean;
        tooltipRaw: Array<number | null>;
        rowIndex: number;
    }
    const leaves: Leaf[] = [];

    const readTooltips = (i: number): Array<number | null> => tooltipCols.map((c) => toNumber(c.values[i]));

    if (hasDedicated) {
        for (let i = 0; i < rowCount; i++) {
            const catLabel = categoryCol ? String(categoryCol.values[i] ?? "") : null;
            const timeLabel = timeCol ? String(timeCol.values[i] ?? "") : null;
            if (catLabel === null && timeLabel === null) {
                continue;
            }
            for (const { kind, col } of dedicated) {
                const v = toNumber(col.values[i]);
                if (v !== null) {
                    leaves.push({
                        catLabel,
                        timeLabel,
                        kind,
                        scenarioLabel: null,
                        value: v,
                        highlighted: rowHighlighted(i),
                        tooltipRaw: readTooltips(i),
                        rowIndex: i
                    });
                }
            }
        }
    } else if (scenarioCol && valueCol) {
        for (let i = 0; i < rowCount; i++) {
            const kind = detectScenario(scenarioCol.values[i]);
            const v = toNumber(valueCol.values[i]);
            if (v === null) {
                continue;
            }
            leaves.push({
                catLabel: categoryCol ? String(categoryCol.values[i] ?? "") : null,
                timeLabel: timeCol ? String(timeCol.values[i] ?? "") : null,
                kind,
                scenarioLabel: String(scenarioCol.values[i] ?? ""),
                value: v,
                highlighted: rowHighlighted(i),
                tooltipRaw: readTooltips(i),
                rowIndex: i
            });
        }
    }

    if (leaves.length === 0) {
        return null;
    }

    // --- aggregate by category (rows) ---
    const rows: CategoryRow[] = [];
    const rowMap = new Map<string, CategoryRow>();
    for (const leaf of leaves) {
        const label = leaf.catLabel ?? leaf.timeLabel;
        if (label === null) {
            continue;
        }
        const anchorColumn = categoryCol ?? timeCol;
        const candidateId = anchorColumn
            ? host.createSelectionIdBuilder().withCategory(anchorColumn, leaf.rowIndex).createSelectionId()
            : host.createSelectionIdBuilder().createSelectionId();
        const identityKey = candidateId.hasIdentity?.() ? candidateId.getKey() : "";
        const rowKey = identityKey || label;
        let row = rowMap.get(rowKey);
        if (!row) {
            row = {
                label,
                values: {},
                selectionId: candidateId,
                highlighted: false,
                tooltipRaw: leaf.tooltipRaw,
                firstRowIndex: leaf.rowIndex
            };
            rowMap.set(rowKey, row);
            rows.push(row);
        }
        row.values[leaf.kind] = (row.values[leaf.kind] ?? 0) + leaf.value;
        row.highlighted = row.highlighted || leaf.highlighted;
    }

    // --- aggregate by time axis ---
    let timeRows: TimeRow[] | null = null;
    if (timeCol) {
        timeRows = [];
        const timeMap = new Map<string, TimeRow>();
        for (const leaf of leaves) {
            if (leaf.timeLabel === null) {
                continue;
            }
            const candidateId = host.createSelectionIdBuilder().withCategory(timeCol, leaf.rowIndex).createSelectionId();
            const identityKey = candidateId.hasIdentity?.() ? candidateId.getKey() : "";
            const rowKey = identityKey || leaf.timeLabel;
            let row = timeMap.get(rowKey);
            if (!row) {
                row = {
                    label: leaf.timeLabel,
                    values: {},
                    selectionId: candidateId,
                    highlighted: false,
                    tooltipRaw: leaf.tooltipRaw,
                    firstRowIndex: leaf.rowIndex
                };
                timeMap.set(rowKey, row);
                timeRows.push(row);
            }
            row.values[leaf.kind] = (row.values[leaf.kind] ?? 0) + leaf.value;
            row.highlighted = row.highlighted || leaf.highlighted;
        }
    }

    // --- scenario bookkeeping ---
    const presentSet = new Set<ScenarioKind>();
    const scenarioDisplay: Partial<Record<ScenarioKind, string>> = {};
    for (const leaf of leaves) {
        presentSet.add(leaf.kind);
        if (leaf.scenarioLabel && !scenarioDisplay[leaf.kind]) {
            scenarioDisplay[leaf.kind] = leaf.scenarioLabel;
        }
    }
    const present = CANON_ORDER.filter((k) => presentSet.has(k));

    const measureNames: Partial<Record<ScenarioKind, string>> = {};
    for (const { kind, col } of dedicated) {
        measureNames[kind] = col.source.displayName;
    }

    return {
        rows,
        timeRows,
        scenarioSource: hasDedicated ? "measures" : "dimension",
        present,
        scenarioDisplay,
        valueFormat: valueCol?.source.format ?? dedicated[0]?.col.source.format,
        tooltipFields: tooltipCols.map((c) => ({ name: c.source.displayName, format: c.source.format })),
        measureNames,
        hasHighlight: highlightActive
    };
}

/** Resolve the comparison base scenario from settings ("auto" picks PY, then PL, then FC). */
export function resolveBaseScenario(
    preferred: string,
    present: ScenarioKind[]
): ScenarioKind | null {
    if (preferred && preferred !== "auto") {
        const forced = preferred as ScenarioKind;

        return present.includes(forced) ? forced : null;
    }
    for (const candidate of ["PY", "PL", "FC"] as ScenarioKind[]) {
        if (present.includes(candidate)) {
            return candidate;
        }
    }

    return null;
}
