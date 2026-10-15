import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmConfigured, llmJson } from "@/lib/llm";
import { TIER_ADVICE_SYSTEM, tierAdviceContext } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { isValidTier } from "@/lib/tier";
import { suggestTierChanges } from "@/lib/tiers-suggest";

export const dynamic = "force-dynamic";

/** GET /api/teacher/tiers?subject=&classId= —— 分层升降候选（AI 理由，未配 Key 时模板兜底） */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const subjectCode = sp.get("subject") ?? "math";
    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
    const cls = sp.get("classId")
      ? classes.find((c) => c.id === sp.get("classId"))
      : classes[0];
    if (!cls) return ok({ error: "没有班级数据" }, 404);

    const items = await suggestTierChanges({ subjectId: subject.id, classId: cls.id });
    const pinned = await prisma.user.findMany({
      where: { role: Role.STUDENT, classId: cls.id, tierOverride: { not: null } },
      select: { id: true, name: true, studentNo: true, tierOverride: true },
      orderBy: { name: "asc" },
    });
    let aiGenerated = false;

    if (items.length && llmConfigured()) {
      try {
        const g = await llmJson<{
          items: { studentName: string; summary: string; reasons: string[] }[];
        }>(
          [
            { role: "system", content: TIER_ADVICE_SYSTEM },
            {
              role: "user",
              content: tierAdviceContext(
                items.map((c) => ({
                  name: c.name,
                  studentNo: c.studentNo,
                  currentLabel: c.currentTier,
                  suggestedLabel: c.suggestedTier,
                  avg: c.avg,
                  trendDelta: c.trendDelta,
                  weakKps: c.weakKps.map((k) => `${k.code} ${k.name}`),
                  errorTags: c.errorTags.map((t) => t.tag),
                }))
              ),
            },
          ],
          { task: "analysis", maxTokens: 4096 }
        );
        // 按输入顺序合并（数量对不齐时保留模板兜底）
        g.items?.forEach((ai, i) => {
          const c = items[i];
          if (!c) return;
          const summary = typeof ai.summary === "string" && ai.summary.trim() ? ai.summary.trim() : "";
          const reasons = Array.isArray(ai.reasons)
            ? ai.reasons.filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.trim()).slice(0, 3)
            : [];
          if (summary) c.advice = { summary, reasons: reasons.length ? reasons : c.advice.reasons };
        });
        aiGenerated = true;
      } catch (e) {
        console.warn("[tiers] AI 理由生成失败，使用模板兜底:", e);
      }
    }

    return ok({ items, pinned, aiGenerated });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/teacher/tiers —— 一键采纳/清除分层锁定 { items: [{ studentId, tier | null }] } */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json().catch(() => ({}));
    const items = body?.items;
    if (!Array.isArray(items) || !items.length) return ok({ error: "items 不能为空" }, 400);

    const valid = items
      .filter((i) => i && typeof i.studentId === "string" && i.studentId.trim())
      .map((i) => ({ studentId: i.studentId.trim(), tier: i.tier ?? null }));
    if (!valid.length) return ok({ error: "没有有效的条目" }, 400);
    for (const i of valid) {
      if (i.tier !== null && !isValidTier(i.tier))
        return ok({ error: `非法分层值：${i.tier}` }, 400);
    }

    // 预读学生（事务外），校验存在且为学生
    const students = await prisma.user.findMany({
      where: { id: { in: valid.map((i) => i.studentId) } },
      select: { id: true, role: true },
    });
    const byId = new Map(students.map((s) => [s.id, s]));
    for (const i of valid) {
      const s = byId.get(i.studentId);
      if (!s) return ok({ error: `学生不存在：${i.studentId}` }, 404);
      if (s.role !== Role.STUDENT) return ok({ error: `不是学生账号：${i.studentId}` }, 400);
    }

    // 批量事务（Neon Pooled 禁交互式事务）
    await prisma.$transaction(
      valid.map((i) =>
        prisma.user.update({ where: { id: i.studentId }, data: { tierOverride: i.tier } })
      )
    );
    return ok({ updated: valid.map((i) => ({ studentId: i.studentId, tierOverride: i.tier })) });
  } catch (e) {
    return fail(e);
  }
}
