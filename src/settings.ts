// Formatting pane model (modern getFormattingModel API).
// Slice names must match capabilities.json objects exactly.

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

class ChartCard extends formattingSettings.SimpleCard {
    name = "chart";
    displayNameKey = "Visual_Object_Chart";

    mode = new formattingSettings.AutoDropdown({
        name: "mode",
        displayNameKey: "Visual_Slice_Mode",
        value: "variance"
    });

    showTotals = new formattingSettings.ToggleSwitch({
        name: "showTotals",
        displayNameKey: "Visual_Slice_ShowTotals",
        value: false
    });

    slices = [this.mode, this.showTotals];
}

class ScenariosCard extends formattingSettings.SimpleCard {
    name = "scenarios";
    displayNameKey = "Visual_Object_Scenarios";

    baseScenario = new formattingSettings.AutoDropdown({
        name: "baseScenario",
        displayNameKey: "Visual_Slice_BaseScenario",
        value: "auto"
    });

    comparisonMode = new formattingSettings.AutoDropdown({
        name: "comparisonMode",
        displayNameKey: "Visual_Slice_ComparisonMode",
        value: "single"
    });

    slices = [this.baseScenario, this.comparisonMode];
}

class VarianceCard extends formattingSettings.SimpleCard {
    name = "variance";
    displayNameKey = "Visual_Object_Variance";

    showDeltaAbs = new formattingSettings.ToggleSwitch({
        name: "showDeltaAbs",
        displayNameKey: "Visual_Slice_ShowDeltaAbs",
        value: true
    });

    showDeltaPct = new formattingSettings.ToggleSwitch({
        name: "showDeltaPct",
        displayNameKey: "Visual_Slice_ShowDeltaPct",
        value: true
    });

    colorMode = new formattingSettings.AutoDropdown({
        name: "colorMode",
        displayNameKey: "Visual_Slice_ColorMode",
        value: "semantic"
    });

    goodDirection = new formattingSettings.AutoDropdown({
        name: "goodDirection",
        displayNameKey: "Visual_Slice_GoodDirection",
        value: "up"
    });

    positiveColor = new formattingSettings.ColorPicker({
        name: "positiveColor",
        displayNameKey: "Visual_Slice_PositiveColor",
        value: { value: "#2E9944" }
    });

    negativeColor = new formattingSettings.ColorPicker({
        name: "negativeColor",
        displayNameKey: "Visual_Slice_NegativeColor",
        value: { value: "#D13438" }
    });

    slices = [this.showDeltaAbs, this.showDeltaPct, this.colorMode, this.goodDirection, this.positiveColor, this.negativeColor];
}

class LabelsCard extends formattingSettings.SimpleCard {
    name = "labels";
    displayNameKey = "Visual_Object_Labels";

    showValueLabels = new formattingSettings.ToggleSwitch({
        name: "showValueLabels",
        displayNameKey: "Visual_Slice_ShowValueLabels",
        value: true
    });

    displayUnits = new formattingSettings.AutoDropdown({
        name: "displayUnits",
        displayNameKey: "Visual_Slice_DisplayUnits",
        value: "0"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayNameKey: "Visual_Slice_FontSize",
        value: 11
    });

    slices = [this.showValueLabels, this.displayUnits, this.fontSize];
}

class NotationCard extends formattingSettings.SimpleCard {
    name = "notation";
    displayNameKey = "Visual_Object_Notation";

    acColor = new formattingSettings.ColorPicker({
        name: "acColor",
        displayNameKey: "Visual_Slice_ACColor",
        value: { value: "#404040" }
    });

    outlineColor = new formattingSettings.ColorPicker({
        name: "outlineColor",
        displayNameKey: "Visual_Slice_OutlineColor",
        value: { value: "#7F7F7F" }
    });

    labelWidth = new formattingSettings.NumUpDown({
        name: "labelWidth",
        displayNameKey: "Visual_Slice_LabelWidth",
        value: 0
    });

    rowHeight = new formattingSettings.NumUpDown({
        name: "rowHeight",
        displayNameKey: "Visual_Slice_RowHeight",
        value: 0,
        options: {
            unitSymbol: "px",
            unitSymbolAfterInput: true
        }
    });

    outlierScale = new formattingSettings.AutoDropdown({
        name: "outlierScale",
        displayNameKey: "Visual_Slice_OutlierScale",
        value: "auto"
    });

    slices = [this.acColor, this.outlineColor, this.labelWidth, this.rowHeight, this.outlierScale];
}

class GridlinesCard extends formattingSettings.SimpleCard {
    name = "gridlines";
    displayNameKey = "Visual_Object_Gridlines";

    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayNameKey: "Visual_Slice_ShowGridlines",
        value: true
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayNameKey: "Visual_Slice_GridlineColor",
        value: { value: "#D8D8D8" }
    });

    slices = [this.show, this.color];
}

class SortCard extends formattingSettings.SimpleCard {
    name = "sortSettings";
    displayNameKey = "Visual_Object_Sort";

    field = new formattingSettings.AutoDropdown({
        name: "field",
        displayNameKey: "Visual_Slice_SortField",
        value: "none"
    });

    direction = new formattingSettings.AutoDropdown({
        name: "direction",
        displayNameKey: "Visual_Slice_SortDirection",
        value: "desc"
    });

    slices = [this.field, this.direction];
}

class TopNCard extends formattingSettings.SimpleCard {
    name = "topN";
    displayNameKey = "Visual_Object_TopN";

    mode = new formattingSettings.AutoDropdown({
        name: "mode",
        displayNameKey: "Visual_Slice_TopNMode",
        value: "off"
    });

    count = new formattingSettings.NumUpDown({
        name: "count",
        displayNameKey: "Visual_Slice_TopNCount",
        value: 10
    });

    percentage = new formattingSettings.NumUpDown({
        name: "percentage",
        displayNameKey: "Visual_Slice_TopNPercentage",
        value: 80
    });

    rankBy = new formattingSettings.AutoDropdown({
        name: "rankBy",
        displayNameKey: "Visual_Slice_TopNRankBy",
        value: "variance"
    });

    includeOthers = new formattingSettings.ToggleSwitch({
        name: "includeOthers",
        displayNameKey: "Visual_Slice_TopNIncludeOthers",
        value: true
    });

    slices = [this.mode, this.count, this.percentage, this.rankBy, this.includeOthers];
}

export class VisualFormattingSettingsModel extends formattingSettings.Model {
    chart = new ChartCard();
    scenarios = new ScenariosCard();
    variance = new VarianceCard();
    labels = new LabelsCard();
    notation = new NotationCard();
    gridlines = new GridlinesCard();
    sortSettings = new SortCard();
    topN = new TopNCard();

    cards = [this.chart, this.scenarios, this.variance, this.labels, this.notation, this.gridlines, this.sortSettings, this.topN];
}
