import PptxGenJS from "pptxgenjs";

/* ============================================================
 * 教案 → PPT 课件生成器（服务端，pptxgenjs）
 * 输入：AI 备课的教案 JSON + 风格/色彩/时长提示
 * 输出：16:9 PPTX 的 Uint8Array
 * ============================================================ */

export interface PrepFlowStage {
  stage: string;
  duration: number;
  intent: string;
  content: string;
}
export interface PrepPedagogy {
  theory: string;
  application: string;
}
export interface PrepInput {
  title: string;
  targets: string[];
  keyPoints: string[];
  difficulties: string[];
  flow: PrepFlowStage[];
  pedagogy: PrepPedagogy[];
  boardDesign: string;
  homework: string;
  preview: string;
}
export interface PrepPptPalette {
  primary: string;
  accent: string;
  light: string;
  text: string;
  subtitle?: string;
}
export interface PrepPptOptions {
  stylePrompt?: string;
  colorPrimary?: string;
  colorAccent?: string;
  durationMinutes?: number;
  subjectName?: string;
  className?: string;
  palette?: Partial<PrepPptPalette> | null;
}

const FONT = "Microsoft YaHei";
const MUTED = "66788A";
const CREAM = "FBF8F2";

function hex(value: string | undefined | null, fallback: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(value ?? "");
  return m ? m[1] : fallback;
}

/** 消毒教案输入（来自客户端，不可信） */
export function sanitizePrepInput(body: unknown): PrepInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fb = "", max = 2000) =>
    typeof v === "string" ? v.slice(0, max) : fb;
  const strArr = (v: unknown, max = 10, itemMax = 300) =>
    Array.isArray(v) ? v.map((x) => String(x).slice(0, itemMax)).slice(0, max) : [];
  const flow: PrepFlowStage[] = (Array.isArray(b.flow) ? b.flow : [])
    .slice(0, 12)
    .map((f, i) => {
      const o = (f ?? {}) as Record<string, unknown>;
      return {
        stage: str(o.stage, `环节 ${i + 1}`, 40),
        duration: Math.min(45, Math.max(1, Math.round(Number(o.duration) || 5))),
        intent: str(o.intent, "", 300),
        content: str(o.content, "", 900),
      };
    })
    .filter((f) => f.content);
  const pedagogy: PrepPedagogy[] = (Array.isArray(b.pedagogy) ? b.pedagogy : [])
    .slice(0, 8)
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { theory: str(o.theory, "", 120), application: str(o.application, "", 400) };
    })
    .filter((p) => p.theory && p.application);
  return {
    title: str(b.title, "教案课件", 120),
    targets: strArr(b.targets, 8, 200),
    keyPoints: strArr(b.keyPoints, 8, 200),
    difficulties: strArr(b.difficulties, 8, 200),
    flow,
    pedagogy,
    boardDesign: str(b.boardDesign, "", 1500),
    homework: str(b.homework, "", 1500),
    preview: str(b.preview, "", 1500),
  };
}

export function resolvePalette(
  palette: Partial<PrepPptPalette> | null | undefined,
  colorPrimary?: string,
  colorAccent?: string
): PrepPptPalette {
  return {
    primary: hex(palette?.primary ?? colorPrimary, "16756B"),
    accent: hex(palette?.accent ?? colorAccent, "B97B22"),
    light: hex(palette?.light, "F2EBDD"),
    text: hex(palette?.text, "2C4155"),
    subtitle: typeof palette?.subtitle === "string" ? palette.subtitle.slice(0, 60) : undefined,
  };
}

function bulletLines(text: string, max = 6): string[] {
  return text
    .split(/\n+|；|;/)
    .map((s) => s.replace(/^[-\s]*/, "").trim())
    .filter(Boolean)
    .slice(0, max)
    .map((s) => (s.length > 220 ? `${s.slice(0, 220)}…` : s));
}

/** 页脚：品牌 + 页码 */
function footer(slide: PptxGenJS.Slide, page: number, total: number) {
  slide.addText("智学慧教 · AI 备课课件", {
    x: 0.55, y: 7.08, w: 3.2, h: 0.3, fontSize: 8, color: MUTED, fontFace: FONT,
  });
  slide.addText(`${page} / ${total}`, {
    x: 12.2, y: 7.08, w: 0.7, h: 0.3, fontSize: 8, color: MUTED, fontFace: FONT,
    align: "right",
  });
}

function topBar(slide: PptxGenJS.Slide, palette: PrepPptPalette) {
  slide.addShape("rect", {
    x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: palette.primary }, line: { color: palette.primary },
  });
}

function sectionHeader(
  slide: PptxGenJS.Slide,
  palette: PrepPptPalette,
  kicker: string,
  title: string,
  sub?: string
) {
  topBar(slide, palette);
  slide.addText(kicker, {
    x: 0.55, y: 0.32, w: 12.2, h: 0.3, fontSize: 10, bold: true, color: palette.accent, fontFace: FONT,
    charSpacing: 2,
  });
  slide.addText(title, {
    x: 0.55, y: 0.62, w: 12.2, h: 0.7, fontSize: 24, bold: true, color: palette.text, fontFace: FONT,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.55, y: 1.32, w: 12.2, h: 0.34, fontSize: 11, color: MUTED, fontFace: FONT,
    });
  }
  slide.addShape("line", {
    x: 0.55, y: 1.28, w: 12.23, h: 0, line: { color: "E1DBCF", width: 0.75 },
  });
}

function titleSlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  opts: PrepPptOptions,
  palette: PrepPptPalette,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: palette.light };
  topBar(slide, palette);
  slide.addText("AI 备课 · 课堂课件", {
    x: 0.55, y: 0.45, w: 12.2, h: 0.3, fontSize: 11, bold: true, color: palette.accent, fontFace: FONT,
    charSpacing: 2,
  });
  slide.addText(prep.title, {
    x: 0.55, y: 0.95, w: 12.2, h: 1.6, fontSize: 30, bold: true, color: palette.text, fontFace: FONT,
    valign: "top", fit: "shrink",
  });
  if (palette.subtitle) {
    slide.addText(palette.subtitle, {
      x: 0.55, y: 2.55, w: 12.2, h: 0.5, fontSize: 14, color: MUTED, fontFace: FONT, fit: "shrink",
    });
  }
  const mins = opts.durationMinutes ?? prep.flow.reduce((a, f) => a + f.duration, 0);
  const meta = [
    opts.subjectName ? `学科：${opts.subjectName}` : "",
    opts.className ? `班级：${opts.className}` : "",
    mins ? `时长：${mins} 分钟` : "",
  ]
    .filter(Boolean)
    .join("   ·   ");
  slide.addText(meta, {
    x: 0.55, y: 3.2, w: 12.2, h: 0.4, fontSize: 12, color: palette.text, fontFace: FONT,
  });
  slide.addText(`由教案一键生成 · ${new Date().toISOString().slice(0, 10)}`, {
    x: 0.55, y: 3.6, w: 12.2, h: 0.4, fontSize: 10, color: MUTED, fontFace: FONT,
  });
  if (opts.stylePrompt) {
    slide.addText(`风格提示：${opts.stylePrompt}`, {
      x: 0.55, y: 4.1, w: 12.2, h: 0.4, fontSize: 10, color: MUTED, fontFace: FONT, fit: "shrink",
    });
  }
  slide.addShape("rect", {
    x: 0.55, y: 6.35, w: 12.23, h: 0.02, fill: { color: palette.primary }, line: { color: palette.primary },
  });
  slide.addText("教师审核后使用 · AI 不作教学决策", {
    x: 0.55, y: 6.45, w: 12.2, h: 0.4, fontSize: 9, color: MUTED, fontFace: FONT, align: "center",
  });
  footer(slide, page, total);
}

function agendaSlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  opts: PrepPptOptions,
  palette: PrepPptPalette,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: CREAM };
  const mins = opts.durationMinutes ?? prep.flow.reduce((a, f) => a + f.duration, 0);
  sectionHeader(slide, palette, "AGENDA", "课堂节奏", `${prep.title} · 共 ${mins} 分钟`);
  const y0 = 1.75;
  const n = Math.max(1, prep.flow.length);
  const step = Math.min(0.62, (6.95 - y0) / Math.max(1, n - 1));
  prep.flow.forEach((f, i) => {
    const y = y0 + i * step;
    slide.addShape("rect", {
      x: 0.55, y, w: 12.23, h: Math.max(0.38, step - 0.1), fill: { color: i % 2 ? "FFFFFF" : palette.light },
      line: { color: "E1DBCF", width: 0.5 },
    });
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: 0.72, y: y + 0.03, w: 0.55, h: Math.max(0.3, step - 0.16), fontSize: 12, bold: true, color: palette.accent, fontFace: FONT,
      valign: "middle",
    });
    slide.addText(f.stage, {
      x: 1.45, y: y + 0.03, w: 8.1, h: Math.max(0.3, step - 0.16), fontSize: 12, bold: true, color: palette.text, fontFace: FONT,
      valign: "middle", fit: "shrink",
    });
    slide.addText(`${f.duration} 分钟`, {
      x: 9.8, y: y + 0.03, w: 2.8, h: Math.max(0.3, step - 0.16), fontSize: 10.5, color: MUTED, fontFace: FONT, align: "right",
      valign: "middle",
    });
  });
  footer(slide, page, total);
}

function bulletsSlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  palette: PrepPptPalette,
  kicker: string,
  title: string,
  items: string[],
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: CREAM };
  sectionHeader(slide, palette, kicker, title);
  const shown = items.slice(0, 8);
  shown.forEach((item, i) => {
    const y = 1.75 + i * 0.62;
    slide.addShape("ellipse", {
      x: 0.7, y: y + 0.13, w: 0.14, h: 0.14, fill: { color: palette.accent }, line: { color: palette.accent },
    });
    slide.addText(`${i + 1}. ${item}`, {
      x: 1.0, y, w: 11.7, h: 0.52, fontSize: 13, color: palette.text, fontFace: FONT, valign: "middle",
      fit: "shrink",
    });
  });
  footer(slide, page, total);
}

function keyDifficultySlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  palette: PrepPptPalette,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: CREAM };
  sectionHeader(slide, palette, "FOCUS", "重点与难点");
  const col = (x: number, title: string, items: string[], color: string, bg: string) => {
    slide.addShape("roundRect", {
      x, y: 1.7, w: 5.9, h: 4.9, fill: { color: bg }, line: { color: "E1DBCF", width: 0.75 },
      rectRadius: 0.06,
    });
    slide.addText(title, {
      x: x + 0.25, y: 1.9, w: 5.4, h: 0.4, fontSize: 14, bold: true, color, fontFace: FONT,
    });
    items.slice(0, 6).forEach((item, i) => {
      slide.addText(`• ${item}`, {
        x: x + 0.25, y: 2.45 + i * 0.68, w: 5.4, h: 0.6, fontSize: 12, color: palette.text,
        fontFace: FONT, fit: "shrink",
      });
    });
  };
  col(0.55, "教学重点", prep.keyPoints, palette.primary, palette.light);
  col(6.9, "教学难点", prep.difficulties, "B2503A", "F9EEDB");
  footer(slide, page, total);
}

function flowSlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  palette: PrepPptPalette,
  stage: PrepFlowStage,
  index: number,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: CREAM };
  sectionHeader(
    slide,
    palette,
    `教学环节 ${index + 1}`,
    stage.stage,
    `设计意图：${stage.intent || "—"}`
  );
  const lines = bulletLines(stage.content, 7);
  lines.forEach((line, i) => {
    const y = 1.9 + i * 0.72;
    slide.addShape("roundRect", {
      x: 0.55, y, w: 12.23, h: 0.62, fill: { color: i % 2 ? "FFFFFF" : palette.light },
      line: { color: "E1DBCF", width: 0.5 }, rectRadius: 0.08,
    });
    slide.addText(line, {
      x: 0.8, y: y + 0.05, w: 11.7, h: 0.52, fontSize: 12.5, color: palette.text, fontFace: FONT,
      valign: "middle", fit: "shrink",
    });
  });
  slide.addText(`本环节 ${stage.duration} 分钟`, {
    x: 0.55, y: 6.6, w: 12.2, h: 0.35, fontSize: 10, bold: true, color: palette.accent, fontFace: FONT,
    align: "right",
  });
  slide.addNotes(`设计意图：${stage.intent}\n\n${stage.content}`);
  footer(slide, page, total);
}

function pedagogySlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  palette: PrepPptPalette,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: CREAM };
  sectionHeader(slide, palette, "PEDAGOGY", "教学方法依据");
  prep.pedagogy.slice(0, 8).forEach((p, i) => {
    const y = 1.75 + i * 0.6;
    slide.addShape("roundRect", {
      x: 0.55, y, w: 12.23, h: 0.52, fill: { color: i % 2 ? "FFFFFF" : palette.light },
      line: { color: "E1DBCF", width: 0.5 }, rectRadius: 0.08,
    });
    slide.addText(p.theory, {
      x: 0.75, y: y + 0.05, w: 3.4, h: 0.42, fontSize: 12, bold: true, color: palette.primary,
      fontFace: FONT, valign: "middle", fit: "shrink",
    });
    slide.addText(p.application, {
      x: 4.3, y: y + 0.05, w: 8.3, h: 0.42, fontSize: 11.5, color: palette.text, fontFace: FONT,
      valign: "middle", fit: "shrink",
    });
  });
  footer(slide, page, total);
}

function textSlide(
  pptx: PptxGenJS,
  palette: PrepPptPalette,
  kicker: string,
  title: string,
  text: string,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: CREAM };
  sectionHeader(slide, palette, kicker, title);
  slide.addShape("roundRect", {
    x: 0.55, y: 1.75, w: 12.23, h: 4.7, fill: { color: "FFFFFF" },
    line: { color: "E1DBCF", width: 0.75 }, rectRadius: 0.04,
  });
  slide.addText(text || "—", {
    x: 0.85, y: 1.95, w: 11.6, h: 4.3, fontSize: 12.5, color: palette.text, fontFace: FONT,
    valign: "top", fit: "shrink",
  });
  footer(slide, page, total);
}

function homeworkPreviewSlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  palette: PrepPptPalette,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: CREAM };
  sectionHeader(slide, palette, "HOMEWORK", "作业与预习");
  const col = (x: number, title: string, text: string, bg: string, color: string) => {
    slide.addShape("roundRect", {
      x, y: 1.7, w: 5.9, h: 4.9, fill: { color: bg }, line: { color: "E1DBCF", width: 0.75 },
      rectRadius: 0.06,
    });
    slide.addText(title, {
      x: x + 0.25, y: 1.9, w: 5.4, h: 0.4, fontSize: 14, bold: true, color, fontFace: FONT,
    });
    slide.addText(text || "—", {
      x: x + 0.25, y: 2.45, w: 5.4, h: 4.0, fontSize: 11.5, color: palette.text, fontFace: FONT,
      valign: "top", fit: "shrink",
    });
  };
  col(0.55, "课后作业（分层）", prep.homework, palette.light, palette.primary);
  col(6.9, "预习任务", prep.preview, "E7F1EE", "16756B");
  footer(slide, page, total);
}

function closingSlide(
  pptx: PptxGenJS,
  prep: PrepInput,
  palette: PrepPptPalette,
  page: number,
  total: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: palette.light };
  topBar(slide, palette);
  slide.addText("谢谢", {
    x: 0.55, y: 2.2, w: 12.2, h: 1.2, fontSize: 40, bold: true, color: palette.text, fontFace: FONT,
    align: "center",
  });
  slide.addText(prep.title, {
    x: 0.55, y: 3.6, w: 12.2, h: 0.6, fontSize: 16, color: palette.primary, fontFace: FONT,
    align: "center", fit: "shrink",
  });
  slide.addText("教学目标 · 教学过程 · 板书 · 作业与预习均整理在前页", {
    x: 0.55, y: 4.4, w: 12.2, h: 0.5, fontSize: 11, color: MUTED, fontFace: FONT, align: "center",
  });
  slide.addText("智学慧教 · AI 备课助手", {
    x: 0.55, y: 6.2, w: 12.2, h: 0.4, fontSize: 10, color: MUTED, fontFace: FONT, align: "center",
  });
  footer(slide, page, total);
}

/** 生成 PPTX（返回 Uint8Array）。所有内容来自已消毒的 prep。 */
export async function buildPrepPptx(
  prep: PrepInput,
  opts: PrepPptOptions = {}
): Promise<Uint8Array> {
  const palette = resolvePalette(opts.palette, opts.colorPrimary, opts.colorAccent);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "智学慧教";
  pptx.title = prep.title;
  pptx.subject = "AI 备课课件";

  const hasAgenda = prep.flow.length > 0;
  const hasTargets = prep.targets.length > 0;
  const hasKey = prep.keyPoints.length > 0 || prep.difficulties.length > 0;
  const hasPedagogy = prep.pedagogy.length > 0;
  const hasBoard = Boolean(prep.boardDesign);
  const hasHomework = Boolean(prep.homework) || Boolean(prep.preview);
  const total =
    1 +
    (hasAgenda ? 1 : 0) +
    (hasTargets ? 1 : 0) +
    (hasKey ? 1 : 0) +
    prep.flow.length +
    (hasPedagogy ? 1 : 0) +
    (hasBoard ? 1 : 0) +
    (hasHomework ? 1 : 0) +
    1;

  let page = 0;
  const next = () => ++page;

  titleSlide(pptx, prep, opts, palette, next(), total);
  if (hasAgenda) agendaSlide(pptx, prep, opts, palette, next(), total);
  if (hasTargets) bulletsSlide(pptx, prep, palette, "OBJECTIVES", "教学目标", prep.targets, next(), total);
  if (hasKey) keyDifficultySlide(pptx, prep, palette, next(), total);
  prep.flow.forEach((f, i) => flowSlide(pptx, prep, palette, f, i, next(), total));
  if (hasPedagogy) pedagogySlide(pptx, prep, palette, next(), total);
  if (hasBoard) textSlide(pptx, palette, "BOARD", "板书设计", prep.boardDesign, next(), total);
  if (hasHomework) homeworkPreviewSlide(pptx, prep, palette, next(), total);
  closingSlide(pptx, prep, palette, next(), total);

  const data = await pptx.write({ outputType: "nodebuffer" });
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
