import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmJson } from "@/lib/llm";
import { PREP_PPT_SYSTEM } from "@/lib/prompts";
import {
  buildDeckPptx,
  buildFallbackDeck,
  sanitizeDeck,
  sanitizePrepInput,
} from "@/lib/prep-ppt";

export const dynamic = "force-dynamic";

/** POST /api/ai/prep/ppt —— 教案一键生成可直接上课的 PPT 课件
 * {prep, stylePrompt?, colorPrimary?, colorAccent?, subjectName?, className?} */
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

    // 1) 让 LLM 把教案展开成逐页课堂内容（例题、步骤、答案、分层练习）
    let deck = null as ReturnType<typeof sanitizeDeck>;
    try {
      const r = await llmJson<unknown>(
        [
          { role: "system", content: PREP_PPT_SYSTEM },
          {
            role: "user",
            content: [
              `风格提示：${stylePrompt || "无（默认清新学术风）"}`,
              colorPrimary ? `主色：${colorPrimary}` : "主色：未指定",
              colorAccent ? `强调色：${colorAccent}` : "强调色：未指定",
              `教案 JSON：\n${JSON.stringify(prep)}`,
            ].join("\n"),
          },
        ],
        { maxTokens: 6000, temperature: 0.4, task: "prep-ppt" }
      );
      deck = sanitizeDeck(r);
    } catch (e) {
      console.warn("[prep-ppt] 课件内容生成失败，回退到教案直出:", e instanceof Error ? e.message : e);
      deck = null;
    }

    // 2) 兜底：LLM 不可用时，按新布局直出教案内容（不放无关信息）
    if (!deck) deck = buildFallbackDeck(prep);

    const data = await buildDeckPptx(deck, {
      colorPrimary,
      colorAccent,
      subjectName: typeof body?.subjectName === "string" ? body.subjectName.slice(0, 40) : undefined,
    });

    const filename = encodeURIComponent(
      `${(deck.deckTitle || "课件").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "课件"}.pptx`
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
