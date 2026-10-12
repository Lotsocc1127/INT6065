/**
 * 图表主题与选项构建器。
 * 颜色遵循 dataviz 参考调色板（连续色阶用蓝色系 100→700，
 * 多序列按槽位顺序 blue/orange/aqua/yellow 固定分配，从不循环）。
 * 数值/标签一律使用文本色，不用序列色。
 */

export interface ChartTheme {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  seq100: string;
  seq200: string;
  seq300: string;
  seq400: string;
  seq500: string;
  seq600: string;
  seq700: string;
}

export const LIGHT_THEME: ChartTheme = {
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  s1: "#2a78d6",
  s2: "#eb6834",
  s3: "#1baf7a",
  s4: "#eda100",
  seq100: "#cde2fb",
  seq200: "#9ec5f4",
  seq300: "#6da7ec",
  seq400: "#3987e5",
  seq500: "#2a78d6",
  seq600: "#1c5cab",
  seq700: "#104281",
};

export const DARK_THEME: ChartTheme = {
  surface: "#1a1a19",
  ink: "#ffffff",
  ink2: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  axis: "#383835",
  s1: "#3987e5",
  s2: "#d95926",
  s3: "#199e70",
  s4: "#c98500",
  seq100: "#104281",
  seq200: "#184f95",
  seq300: "#1c5cab",
  seq400: "#2a78d6",
  seq500: "#3987e5",
  seq600: "#6da7ec",
  seq700: "#cde2fb",
};

/** 客户端读取（主题由 globals.css 的 CSS 变量与 prefers-color-scheme 控制） */
export function chartTheme(): ChartTheme {
  if (typeof window === "undefined") return LIGHT_THEME;
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const s = getComputedStyle(document.documentElement);
  const read = (name: string, fb: string) => {
    const v = s.getPropertyValue(name).trim();
    return v || fb;
  };
  const base = isDark ? DARK_THEME : LIGHT_THEME;
  return {
    surface: read("--chart-surface", base.surface),
    ink: read("--chart-ink", base.ink),
    ink2: read("--chart-ink2", base.ink2),
    muted: read("--chart-muted", base.muted),
    grid: read("--chart-grid", base.grid),
    axis: read("--chart-axis", base.axis),
    s1: read("--chart-s1", base.s1),
    s2: read("--chart-s2", base.s2),
    s3: read("--chart-s3", base.s3),
    s4: read("--chart-s4", base.s4),
    seq100: read("--chart-seq100", base.seq100),
    seq200: read("--chart-seq200", base.seq200),
    seq300: read("--chart-seq300", base.seq300),
    seq400: read("--chart-seq400", base.seq400),
    seq500: read("--chart-seq500", base.seq500),
    seq600: read("--chart-seq600", base.seq600),
    seq700: read("--chart-seq700", base.seq700),
  };
}

/** 班级掌握度热力图：行=学生，列=知识点，值=掌握度（连续色阶，蓝 100→700） */
export function heatmapOption(opts: {
  students: string[];
  kps: string[];
  data: [number, number, number][]; // [studentIdx, kpIdx, value]
}) {
  const t = chartTheme();
  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    tooltip: {
      formatter: (p: { data: [number, number, number] }) => {
        const v = p.data[2];
        return `${opts.students[p.data[0]]}<br/>${opts.kps[p.data[1]]}：${Math.round(v * 100)}%`;
      },
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.ink },
    },
    grid: { left: 8, right: 24, top: 8, bottom: 76, containLabel: true },
    xAxis: {
      type: "category",
      data: opts.kps,
      splitArea: { show: true },
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.muted },
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      data: opts.students,
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.ink2 },
      axisTick: { show: false },
    },
    visualMap: {
      type: "piecewise",
      min: 0,
      max: 1,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 14,
      itemHeight: 10,
      textStyle: { color: t.muted, fontSize: 11 },
      pieces: [
        { gte: 0.8, lte: 1, color: t.seq700, label: "80-100%" },
        { gte: 0.6, lt: 0.8, color: t.seq500, label: "60-80%" },
        { gte: 0.4, lt: 0.6, color: t.seq300, label: "40-60%" },
        { gte: 0.2, lt: 0.4, color: t.seq200, label: "20-40%" },
        { gte: 0, lt: 0.2, color: t.seq100, label: "0-20%" },
      ],
    },
    series: [
      {
        type: "heatmap",
        data: opts.data,
        label: {
          show: true,
          formatter: (p: { value: [number, number, number] }) => `${Math.round(p.value[2] * 100)}`,
          fontSize: 10,
          color: t.ink2,
        },
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 2 } },
      },
    ],
  };
}

/** 学生掌握度雷达图：单序列（槽位 1 蓝），标题即图例 */
export function radarOption(opts: { indicators: { name: string; max: number }[]; values: number[] }) {
  const t = chartTheme();
  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    tooltip: {
      formatter: (p: { value: number }) => `${Math.round((p.value ?? 0) * 100)}%`,
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.ink },
    },
    radar: {
      indicator: opts.indicators,
      radius: "62%",
      splitNumber: 4,
      axisName: { color: t.ink2 },
      splitLine: { lineStyle: { color: t.grid } },
      splitArea: { areaStyle: { color: ["transparent"] } },
      axisLine: { lineStyle: { color: t.grid } },
    },
    series: [
      {
        type: "radar",
        data: [
          {
            value: opts.values,
            name: "掌握度",
            lineStyle: { color: t.s1, width: 2 },
            itemStyle: { color: t.s1, borderColor: t.surface, borderWidth: 2 },
            areaStyle: { color: t.s1, opacity: 0.15 },
          },
        ],
      },
    ],
  };
}

/** 折线（趋势/成长）：序列按槽位 1-4 固定分配，≥2 条序列时显示图例，十字线+悬浮提示 */
export function lineOption(opts: {
  xLabels: string[];
  series: { name: string; data: (number | null)[] }[];
  yFormatter?: (v: number) => string;
  smooth?: boolean;
}) {
  const t = chartTheme();
  const slots = [t.s1, t.s2, t.s3, t.s4];
  const series = opts.series.map((s, i) => ({
    name: s.name,
    type: "line" as const,
    data: s.data,
    smooth: opts.smooth ?? false,
    connectNulls: true,
    symbolSize: 7,
    lineStyle: { width: 2, color: slots[i % slots.length] },
    itemStyle: { color: slots[i % slots.length], borderColor: t.surface, borderWidth: 2 },
  }));
  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.ink },
      valueFormatter: opts.yFormatter,
      axisPointer: { type: "cross" as const, lineStyle: { color: t.axis }, crossStyle: { color: t.axis } },
    },
    legend:
      series.length > 1
        ? { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: t.ink2 } }
        : undefined,
    grid: { left: 8, right: 24, top: 20, bottom: series.length > 1 ? 40 : 12, containLabel: true },
    xAxis: {
      type: "category",
      data: opts.xLabels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.muted },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      axisLabel: { color: t.muted, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: t.grid } },
    },
    series,
  };
}

/** 柱状（类别=知识点）：单序列一律槽位 1 蓝，标题即图例，柱上直接标注数值 */
export function barOption(opts: { categories: string[]; name: string; data: number[] }) {
  const t = chartTheme();
  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    tooltip: {
      formatter: (p: { value: number }) => `${Math.round(p.value * 100)}%`,
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.ink },
    },
    grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: opts.categories,
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.ink2 },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      axisLabel: { color: t.muted, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: t.grid } },
    },
    series: [
      {
        name: opts.name,
        type: "bar",
        data: opts.data,
        barWidth: "46%",
        itemStyle: { color: t.s1, borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: "top",
          formatter: (p: { value: number }) => `${Math.round(p.value * 100)}%`,
          color: t.ink2,
          fontSize: 11,
        },
      },
    ],
  };
}
