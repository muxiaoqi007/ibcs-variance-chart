// Shared helpers: text measurement, truncation and number formatting.

import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
    if (!measureContext) {
        const canvas = document.createElement("canvas");
        measureContext = canvas.getContext("2d");
    }

    return measureContext;
}

export function fontString(fontSize: number, fontWeight: number = 400): string {
    return `${fontWeight} ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
}

/** Measure text width with a CJK-safe canvas fallback. */
export function measureText(text: string, fontSize: number, fontWeight: number = 400): number {
    const ctx = getMeasureContext();
    if (ctx) {
        ctx.font = fontString(fontSize, fontWeight);

        return ctx.measureText(text).width;
    }
    // Rough fallback: CJK chars are roughly one em wide.
    let width = 0;
    for (const ch of text) {
        width += ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.55;
    }

    return width;
}

export function truncateText(text: string, maxWidth: number, fontSize: number, fontWeight: number = 400): string {
    if (measureText(text, fontSize, fontWeight) <= maxWidth) {
        return text;
    }
    const ellipsis = "…";
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measureText(text.slice(0, mid) + ellipsis, fontSize, fontWeight) <= maxWidth) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    return text.slice(0, lo) + ellipsis;
}

export interface FormatterOptions {
    format?: string;
    /** 0 = auto display units. */
    displayUnits: number;
    /** Used for automatic display unit selection. */
    maxValue?: number;
}

export type Formatter = (value: number) => string;

export function createFormatter(options: FormatterOptions): Formatter {
    // The display unit system is sized by `value`: an explicit display-unit
    // setting forces that unit, otherwise the data maximum selects one (auto).
    const formatter = valueFormatter.create({
        format: options.format,
        value: options.displayUnits || options.maxValue || 0,
        allowFormatBeautification: true
    });

    return (value: number) => formatter.format(value);
}

export function createPercentFormatter(): Formatter {
    const formatter = valueFormatter.create({ format: "0.0 %", precision: 1 });

    return (value: number) => formatter.format(value);
}

/** Format a signed delta: "+2.9bn" / "-1.2M" using the provided base formatter. */
export function formatSigned(base: Formatter, value: number): string {
    if (!isFinite(value)) {
        return "";
    }
    const sign = value > 0 ? "+" : "";

    return sign + base(value);
}

export function formatSignedPercent(value: number): string {
    if (!isFinite(value)) {
        return "";
    }
    const sign = value > 0 ? "+" : "";

    return `${sign}${(value * 100).toFixed(1)}%`;
}

export function isNumeric(value: unknown): value is number {
    return typeof value === "number" && isFinite(value);
}

export function toNumber(value: unknown): number | null {
    return typeof value === "number" && isFinite(value) ? value : null;
}
