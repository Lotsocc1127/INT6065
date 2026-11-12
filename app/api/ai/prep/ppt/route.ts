import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmJson } from "@/lib/llm";
import { PREP_PPT_SYSTEM } from "@/lib/prompts";
import {
  buildPrepPptx,
  sanitizePrepInput,
  type PrepPptPalette,
} from "@/lib/prep-ppt";

export const dynamic = "force-dynamic";

/** POST /api/ai/prep/ppt —— 教案一键生成 PPT 课件（pptx 下载）
 * {prep, stylePrompt?, colorPrimary?, colorAccent?, durationMinutes?, subjectName?, className?} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();

    const prep = sanitizePrepInput(body?.prep);
    if (!prep.flow.length) {
      return NextResponse.json({ error: "教案内容为空，请先生成教案" }, { status: 400 });
    }

    const stylePrompt = String(body?.stylePrompt ?? "").slice(0, 200).trim();
    const colorPrimary = String(body?.colorPrimary ?? "").slice(0, 9);
    const colorAccent = String(body?.colorAccent ?? "").slice(0, 9);
    const durationMinutesRaw = Number(body?.durationMinutes);
    const durationMinutes = Number.isFinite(durationMinutesRaw)
      ? Math.min(600, Math.max(1, Math.round(durationMinutesRaw)))
      : undefined;

    // 风格提示词 → AI 配色 + 副标题；失败时回退到用户颜色/默认色
    let palette: Partial<PrepPptPalette> | null = null;
    if (stylePrompt) {
      try {
        const r = await llmJson<{
          palette?: { primary?: unknown; accent?: unknown; light?: unknown; text?: unknown };
          subtitle?: unknown;
        }>(
          [
            { role: "system", content: PREP_PPT_SYSTEM },
            {
              role: "user",
              content: [
                `风格提示：${stylePrompt}`,
                colorPrimary ? `主色：${colorPrimary}` : "主色：未指定",
                colorAccent ? `强调色：${colorAccent}` : "强调色：未指定",
                `教案标题：${prep.title}`,
              ].join("\n"),
            },
          ],
          { maxTokens: 400, temperature: 0.4, task: "prep-ppt" }
        );
        palette = {
          primary: typeof r?.palette?.primary === "string" ? r.palette.primary : colorPrimary,
          accent: typeof r?.palette?.accent === "string" ? r.palette.accent : colorAccent,
          light: typeof r?.palette?.light === "string" ? r.palette.light : undefined,
          text: typeof r?.palette?.text === "string" ? r.palette.text : undefined,
          subtitle: typeof r?.subtitle === "string" ? r.subtitle : undefined,
        };
      } catch (e) {
        console.warn("[prep-ppt] 配色生成失败，使用默认配色:", e instanceof Error ? e.message : e);
        palette = null;
      }
    }

    const data = await buildPrepPptx(prep, {
      stylePrompt,
      colorPrimary,
      colorAccent,
      durationMinutes,
      subjectName: typeof body?.subjectName === "string" ? body.subjectName.slice(0, 40) : undefined,
      className: typeof body?.className === "string" ? body.className.slice(0, 40) : undefined,
      palette,
    });

    const filename = encodeURIComponent(
      `${(prep.title || "教案").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "教案"}课件.pptx`
    );
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
