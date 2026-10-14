import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateTypedQuestions } from "@/lib/gen";
import { aggregateRemedialKps, kpContext, pickTier } from "@/lib/remedial";
import type { Tier } from "@/lib/mastery";

export const dynamic = "force-dynamic";

const TIER_VALUES = ["foundation", "intermediate", "advanced"];

/** POST /api/remedial/generate —— 变式补救题生成：{subjectCode, kpIds(≤4), perKp(1-3), tier:"auto"|Tier, classId?} */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json();
    const subjectCode = String(body?.subjectCode ?? "math");
    const kpIds: string[] = (Array.isArray(body?.kpIds) ? body.kpIds : []).map(String);
    if (!kpIds.length) return ok({ error: "请选择至少一个知识点" }, 400);
    if (kpIds.length > 4) return ok({ error: "一次最多选择 4 个知识点" }, 400);
    const perKp = Math.min(3, Math.max(1, Number(body?.perKp) || 2));
    const classId = body?.classId ? String(body.classId) : undefined;

    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);
    const kps = await prisma.knowledgePoint.findMany({
      where: { id: { in: kpIds }, subjectId: subject.id },
      orderBy: { code: "asc" },
    });
    if (!kps.length) return ok({ error: "没有可选知识点" }, 400);

    // 错题聚合：auto 层级 + 出题上下文
    const aggs = await aggregateRemedialKps({ subjectId: subject.id, classId });
    const aggById = new Map(aggs.map((a) => [a.kpId, a]));
    const tier: Tier = TIER_VALUES.includes(body?.tier) ? (body.tier as Tier) : pickTier(aggs);

    // 逐 kp 顺序生成（成本控制）；单个 kp 失败记 failedKps 继续，全失败 502
    const questions: {
      stem: string;
      type: string;
      options: string[] | null;
      answer: string;
      analysis: string;
      kpId: string;
      difficulty: number;
      tier: Tier;
    }[] = [];
    const failedKps: string[] = [];
    for (const kp of kps) {
      const agg = aggById.get(kp.id);
      try {
        const qs = await generateTypedQuestions({
          subjectName: subject.name,
          kps: [{ code: kp.code, name: kp.name, id: kp.id }],
          tier,
          count: perKp,
          context: agg ? kpContext(agg) : undefined,
        });
        questions.push(...qs.map((q) => ({ ...q, tier })));
      } catch (e) {
        console.warn(`[remedial/generate] 知识点 ${kp.code} 生成失败:`, e);
        failedKps.push(kp.code);
      }
    }
    if (!questions.length) {
      return ok(
        { error: "AI 未能生成任何题目（可能未配置 LLM API Key）", failedKps },
        502
      );
    }
    return ok({ questions, tier, failedKps });
  } catch (e) {
    return fail(e);
  }
}
