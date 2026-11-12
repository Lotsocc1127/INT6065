import PptxGenJS from "pptxgenjs";

/* ============================================================
 * 教案 → 可直接上课的 PPT 课件（服务端，pptxgenjs）
 * 由 LLM 把教案展开成逐页课堂内容（例题、步骤、答案、分层练习），
 * 页面只放上课内容：无风格提示词、无生成日期、无多余页脚。
 * ============================================================ */

const FONT = "Microsoft YaHei";
const MUTED = "8B9AA8";
const WHITE = "FFFFFF";
const WARN = "B2503A";

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
}
export interface DeckBlock {
  title?: string;
  lines: string[];
  highlight?: boolean;
}
export interface DeckSlide {
  header: string;
  kicker?: string;
  blocks: DeckBlock[];
  tip?: string;
  notes?: string;
}
export interface DeckSpec {
  deckTitle: string;
  subtitle?: string;
  palette?: Partial<PrepPptPalette>;
  slides: DeckSlide[];
}
export interface PrepPptOptions {
  colorPrimary?: string;
  colorAccent?: string;
  subjectName?: string;
}

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
        content: str(o.content, "", 1200),
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

function cleanLine(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/^[#\-\s·•]+/, "")
    .replace(/`/g, "")
    .replace(/\\[()[\]]/g, "")
    .replace(/\$/g, "")
    .trim();
}

/** 消毒 LLM 输出的课件结构 */
export function sanitizeDeck(body: unknown): DeckSpec | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const deckTitle = String(b.deckTitle ?? "").slice(0, 40).trim();
  if (!deckTitle) return null;
  const slides: DeckSlide[] = (Array.isArray(b.slides) ? b.slides : [])
    .slice(0, 18)
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const blocks: DeckBlock[] = (Array.isArray(o.blocks) ? o.blocks : [])
        .slice(0, 3)
        .map((bl) => {
          const x = (bl ?? {}) as Record<string, unknown>;
          return {
            title: String(x.title ?? "").slice(0, 8).trim(),
            lines: (Array.isArray(x.lines) ? x.lines : [])
              .map((l) => cleanLine(String(l)).slice(0, 36))
              .filter(Boolean)
              .slice(0, 5),
            highlight: Boolean(x.highlight),
          };
        })
        .filter((bl) => bl.lines.length);
      return {
        header: String(o.header ?? "").slice(0, 24).trim(),
        kicker: String(o.kicker ?? "").slice(0, 10).trim(),
        blocks,
        tip: String(o.tip ?? "").slice(0, 30).trim(),
      };
    })
    .filter((s) => s.header && s.blocks.length);
  if (!slides.length) return null;
  const pal = (b.palette ?? {}) as Record<string, unknown>;
  return {
    deckTitle,
    subtitle: String(b.subtitle ?? "").slice(0, 24).trim(),
    palette: {
      primary: typeof pal.primary === "string" ? pal.primary : undefined,
      accent: typeof pal.accent === "string" ? pal.accent : undefined,
      light: typeof pal.light === "string" ? pal.light : undefined,
    },
    slides,
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
    text: "2C4155",
  };
}

function linesOf(text: string, max = 6): string[] {
  return text
    .split(/\n+|；|;/)
    .map((s) => cleanLine(s))
    .filter(Boolean)
    .slice(0, max)
    .map((s) => (s.length > 120 ? `${s.slice(0, 120)}…` : s));
}

/** LLM 失败时的兜底课件：教案内容直接成页（同样不放无关信息） */
export function buildFallbackDeck(prep: PrepInput): DeckSpec {
  const slides: DeckSlide[] = [];
  if (prep.targets.length) {
    slides.push({ header: "学习目标", blocks: [{ lines: prep.targets.slice(0, 6) }] });
  }
  if (prep.keyPoints.length || prep.difficulties.length) {
    slides.push({
      header: "重点与难点",
      blocks: [
        { title: "重点", lines: prep.keyPoints.slice(0, 4) },
        { title: "难点", lines: prep.difficulties.slice(0, 4) },
      ],
    });
  }
  for (const f of prep.flow) {
    slides.push({
      header: f.stage,
      blocks: [{ lines: linesOf(f.content, 6) }],
      notes: `设计意图：${f.intent}\n\n${f.content}`,
    });
  }
  if (prep.homework || prep.preview) {
    slides.push({
      header: "作业与预习",
      blocks: [
        { title: "课后作业", lines: linesOf(prep.homework, 5) },
        { title: "预习任务", lines: linesOf(prep.preview, 5) },
      ],
    });
  }
  return { deckTitle: prep.title, slides };
}

/* ---------------- 渲染 ---------------- */

function headerOf(
  slide: PptxGenJS.Slide,
  palette: PrepPptPalette,
  s: DeckSlide,
  page: number
) {
  slide.addShape("rect", {
    x: 0, y: 0, w: 13.33, h: 0.1, fill: { color: palette.primary }, line: { color: palette.primary },
  });
  if (s.kicker) {
    slide.addText(s.kicker, {
      x: 0.55, y: 0.3, w: 12.2, h: 0.3, fontSize: 11, bold: true, color: palette.accent,
      fontFace: FONT, charSpacing: 2,
    });
  }
  slide.addText(s.header, {
    x: 0.55, y: s.kicker ? 0.58 : 0.42, w: 12.2, h: 0.75, fontSize: 24, bold: true, color: palette.text,
    fontFace: FONT, valign: "middle", fit: "shrink",
  });
  slide.addShape("rect", {
    x: 0.57, y: s.kicker ? 1.32 : 1.18, w: 1.6, h: 0.05, fill: { color: palette.accent },
    line: { color: palette.accent },
  });
  if (page > 0) {
    slide.addText(`${page}`, {
      x: 12.35, y: 7.06, w: 0.6, h: 0.28, fontSize: 9, color: MUTED, fontFace: FONT, align: "right",
    });
  }
}

function blockLines(
  slide: PptxGenJS.Slide,
  palette: PrepPptPalette,
  block: DeckBlock,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number
) {
  if (block.title) {
    slide.addText(block.title, {
      x, y, w, h: 0.32, fontSize: 13, bold: true, color: palette.accent, fontFace: FONT, valign: "middle",
    });
  }
  const lines = block.lines.slice(0, 5);
  const titleH = block.title ? 0.36 : 0;
  const lineH = Math.min(0.62, (h - titleH) / Math.max(1, lines.length));
  lines.forEach((line, i) => {
    slide.addText(
      [
        { text: "▍", options: { color: palette.accent, bold: true, fontSize: Math.max(11, fontSize - 3) } },
        { text: ` ${line}`, options: { color: palette.text, fontSize } },
      ],
      {
        x, y: y + titleH + i * lineH, w, h: lineH, fontFace: FONT, valign: "middle",
        breakLine: false, fit: "shrink",
      }
    );
  });
}

function contentSlide(
  pptx: PptxGenJS,
  palette: PrepPptPalette,
  s: DeckSlide,
  page: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: WHITE };
  headerOf(slide, palette, s, page);

  const main = s.blocks.filter((b) => !b.highlight);
  const answers = s.blocks.filter((b) => b.highlight);
  const contentTop = s.kicker ? 1.55 : 1.42;
  const answerH = answers.length ? 1.15 : 0;
  const contentH = 5.45 - contentTop - (s.tip ? 0.42 : 0) - (answerH > 0 ? answerH + 0.15 : 0);

  if (main.length === 2) {
    blockLines(slide, palette, main[0], 0.55, contentTop, 6.0, contentH, 17);
    blockLines(slide, palette, main[1], 6.85, contentTop, 6.0, contentH, 17);
  } else if (main.length === 3) {
    const w = 3.95;
    main.forEach((b, i) => blockLines(slide, palette, b, 0.55 + i * 4.1, contentTop, w, contentH, 15));
  } else if (main.length === 1) {
    blockLines(slide, palette, main[0], 0.55, contentTop, 12.2, contentH, 20);
  }

  // 答案/结果面板
  answers.forEach((a, i) => {
    const x = answers.length === 2 ? 0.55 + i * 6.15 : 0.55;
    const w = answers.length === 2 ? 6.0 : 12.23;
    const y = 5.62;
    slide.addShape("roundRect", {
      x, y, w, h: answerH, fill: { color: palette.light }, line: { color: palette.accent, width: 1 },
      rectRadius: 0.08,
    });
    const label = a.title || "答案";
    slide.addText(label, {
      x: x + 0.25, y: y + 0.08, w: 1.4, h: 0.3, fontSize: 12, bold: true, color: palette.accent, fontFace: FONT,
    });
    slide.addText(a.lines.slice(0, 3).join("    "), {
      x: x + 1.65, y: y + 0.08, w: w - 1.9, h: answerH - 0.16, fontSize: 16, color: palette.text, fontFace: FONT,
      valign: "middle", fit: "shrink",
    });
  });

  if (s.tip) {
    slide.addText(`注意 · ${s.tip}`, {
      x: 0.55, y: 6.85, w: 12.2, h: 0.3, fontSize: 12, italic: true, bold: true, color: WARN, fontFace: FONT,
      fit: "shrink",
    });
  }
  if (s.notes) slide.addNotes(s.notes);
}

function titleSlide(
  pptx: PptxGenJS,
  palette: PrepPptPalette,
  deck: DeckSpec,
  opts: PrepPptOptions,
  page: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: palette.light };
  slide.addShape("rect", {
    x: 0, y: 0, w: 13.33, h: 0.14, fill: { color: palette.primary }, line: { color: palette.primary },
  });
  if (opts.subjectName) {
    slide.addText(opts.subjectName, {
      x: 0.55, y: 0.55, w: 12.2, h: 0.35, fontSize: 12, bold: true, color: palette.accent,
      fontFace: FONT, charSpacing: 2,
    });
  }
  slide.addText(deck.deckTitle, {
    x: 0.55, y: 1.15, w: 12.2, h: 1.9, fontSize: 32, bold: true, color: palette.text, fontFace: FONT,
    valign: "top", fit: "shrink",
  });
  if (deck.subtitle) {
    slide.addText(deck.subtitle, {
      x: 0.55, y: 3.1, w: 12.2, h: 0.5, fontSize: 15, color: "5A6B7B", fontFace: FONT, fit: "shrink",
    });
  }
  slide.addShape("rect", {
    x: 0.57, y: 6.2, w: 1.8, h: 0.06, fill: { color: palette.accent }, line: { color: palette.accent },
  });
  slide.addText(`${page}`, {
    x: 12.35, y: 7.06, w: 0.6, h: 0.28, fontSize: 9, color: MUTED, fontFace: FONT, align: "right",
  });
}

function closingSlide(
  pptx: PptxGenJS,
  palette: PrepPptPalette,
  deck: DeckSpec,
  page: number
) {
  const slide = pptx.addSlide();
  slide.background = { color: palette.light };
  slide.addShape("rect", {
    x: 0, y: 0, w: 13.33, h: 0.14, fill: { color: palette.primary }, line: { color: palette.primary },
  });
  slide.addText("谢谢", {
    x: 0.55, y: 2.2, w: 12.2, h: 1.2, fontSize: 40, bold: true, color: palette.text, fontFace: FONT,
    align: "center",
  });
  slide.addText(deck.deckTitle, {
    x: 0.55, y: 3.6, w: 12.2, h: 0.6, fontSize: 16, color: palette.primary, fontFace: FONT,
    align: "center", fit: "shrink",
  });
  slide.addText(`${page}`, {
    x: 12.35, y: 7.06, w: 0.6, h: 0.28, fontSize: 9, color: MUTED, fontFace: FONT, align: "right",
  });
}

/** 渲染课件并返回 Uint8Array */
export async function buildDeckPptx(
  deck: DeckSpec,
  opts: PrepPptOptions = {}
): Promise<Uint8Array> {
  const palette = resolvePalette(deck.palette, opts.colorPrimary, opts.colorAccent);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "智学慧教";
  pptx.title = deck.deckTitle;
  pptx.subject = "课堂课件";

  let page = 1;
  titleSlide(pptx, palette, deck, opts, page);
  page++;
  deck.slides.forEach((s) => contentSlide(pptx, palette, s, page++));
  closingSlide(pptx, palette, deck, page);

  const data = await pptx.write({ outputType: "nodebuffer" });
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
