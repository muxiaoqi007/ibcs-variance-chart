# IBCS Charts for Power BI

符合 [IBCS](https://www.ibcs.com/)（International Business Communication Standards）记法的 Power BI 自定义视觉对象，交互与风格参考 Zebra BI。一个视觉对象内置四种图表模式，支持"场景维度字段（长表）"与"专用场景度量（宽表）"两种数据接入方式。

## 四种图表模式

在格式面板「图表 → 图表类型」中切换：

| 模式 | 说明 |
| --- | --- |
| 方差组合图（默认） | 每行一个类别：AC 实心横条 + ΔPY 左右发散增减条 + ΔPY% 棒棒糖标记（数值右对齐），即 Zebra BI 的经典组合表 |
| 时间序列 | 按时间轴叠加场景列：PY 空心 / PL 斜纹 / FC 虚线空心 / AC 实心前置，底部带语义图例 |
| 瀑布图 | 有基准场景时为"基准合计 → 各类别差异 → 实际合计"的差异瀑布；否则为数值增量瀑布 + 合计列 |
| 语义表格 | IBCS 记法表格：右对齐数字、场景缩写列头、差异列绿/红着色、基准场景列灰色弱化 |

## IBCS 语义记法

| 场景 | 记法 |
| --- | --- |
| AC 实际值 | 实心填充 |
| PY 同期值 | 空心轮廓 |
| PL 计划/预算 | 斜纹（45°）轮廓 |
| FC 预测值 | 虚线轮廓 |

差异着色支持"语义色（绿/红）/ 中性色"与"向好方向（增长为好/下降为好）"设置，成本类指标可反向着色。

## 字段桶（两种接入方式二选一）

**方式一：场景维度（长表）**

- 类别（Category）：行分组字段
- 场景（Scenario）：取值为 `AC / PY / PL / FC` 等缩写或中文（实际/同期/预算/预测…），自动识别
- 值（Value）：按场景计算的度量

**方式二：专用度量（宽表）**

- 类别（Category）
- 实际值 (AC) / 同期值 (PY) / 计划值 (PL) / 预测值 (FC)：分别拖入对应度量
- 工具提示（Tooltips）：附加度量（最多 5 个）

时间序列模式可额外拖入「时间轴」字段。

## 排序

点击列头 `AC` / `ΔPY` / `ΔPY%`（表格模式为对应数字列头）即可排序：同一列再次点击切换升/降序，当前排序列显示 ↓/↑。排序状态随报告保存，也可在格式面板「排序」卡片手动设置。

## 显示单位

格式面板「标签 → 显示单位」：自动 / 无 / 千 / 百万 / 十亿。度量自身的格式串（货币、百分比等）会被保留。

## Top N + 其他

格式面板「Top N + 其他」支持按实际值绝对值或绝对差异排名，可以保留固定项目数，也可以保留达到指定累计占比的项目。被筛出的类别可自动汇总为“其他”；此设置应用于方差图、语义表格和瀑布图，不会打乱时间序列的完整时间轴。

## 多基准比较

当 PY、PL、FC 中有多个场景时，可在「场景 → 对比模式」选择“全部可用基准”。方差图、语义表格和瀑布图将以同步面板同时展示 AC 对各基准的差异；“选定基准”则保持原来的单面板显示。

## 响应式与无障碍

- 方差图和语义表格会根据画布宽度自动减少次要差异列，避免窄尺寸横向溢出。
- 类别超过当前高度可清晰容纳的数量时，只呈现可见行并在底部提示剩余项数；可结合视觉对象筛选器控制展示范围。
- 数据点和可排序列头支持键盘聚焦，按 `Enter` / `Space` 选择或排序，按 `Shift+F10` 打开数据点上下文菜单。
- 支持 Power BI 高对比度配色。

## 开发与构建

工具链（已在 Windows 环境验证）：

- Power BI visuals API `5.9.0`（`powerbi-visuals-api ~5.9.0`）
- TypeScript 5.5 + webpack 5 + D3 v7
- `powerbi-visuals-utils-formattingmodel 6.0.4`（精确锁定，勿用 7.x ESM）
- 打包必须使用 pbiviz CLI（`powerbi-visuals-tools 6.2.0`，已作为本地 devDependency）

```bash
npm install
npm run build            # webpack 生产构建（产物 dist/visual.js，仅供检查）
npx pbiviz package       # 生成可导入的 dist/<guid>.<version>.pbiviz
npm run dev              # 开发监听
```

> 注意：webpack 插件 `generatePbiviz` 直接产出的 .pbiviz 缺少宿主插件注册包装器（`visuals.plugins.<guid>`），导入后画布空白；**必须用 `npx pbiviz package`**。CLI 要求四段式版本号（如 `1.6.0.0`）且 `tsconfig.json` 必须含 `files` 字段。

自检（jsdom 全链路，覆盖四种模式、场景识别与排序）：

```bash
npm test
npm run lint
```

## 版本与发布

- Releases 页面附带可直接导入的 `.pbiviz` 产物
- guid：`ibcsChartsK5M2P8Q4R7`（同 guid 重新导入可原地更新）
- 本地化：`stringResources/zh-CN` 与 `en-US`

## License

MIT
