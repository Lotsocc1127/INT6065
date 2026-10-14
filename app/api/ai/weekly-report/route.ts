import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { llmConfigured, llmJson } from "@/lib/llm";
import { WEEKLY_REPORT_SYSTEM, weeklyReportContext } from "@/lib/prompts";
import { prisma } from "@/lib/prisma";
import { aggregateWeeklyReport, buildReportFallback } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";

/** POST /api/ai/weekly-report —— 班级学情周报（近7天 vs 前7天；无 Key/LLM 失败时模板兜底，不返回 502） */
export async function POST(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const body = await req.json().catch(() => ({}));
    const subjectCode = String(body?.subjectCode ?? "math");
    const subject = await prisma.subject.findUnique({ where: { code: subjectCode } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
    const cls = body?.classId
      ? classes.find((c: { id: string }) => c.id === body.classId)
      : classes[0];
    if (!cls) return ok({ error: "没有班级数据" }, 404);

    const stats = await aggregateWeeklyReport({
      subjectId: subject.id,
      subjectName: subject.name,
      classId: cls.id,
      className: cls.name,
    });

    let report = buildReportFallback(stats);
    let aiGenerated = false;

    if (llmConfigured()) {
      try {
        const g = await llmJson<{ title: string; summary: string; suggestions: string[] }>(
          [
            { role: "system", content: WEEKLY_REPORT_SYSTEM },
            {
              role: "user",
              content: weeklyReportContext({
                subjectName: stats.subjectName,
                className: stats.className,
                studentCount: stats.studentCount,
                currentRange: `${new Date(stats.range.current.from).getMonth() + 1}/${new Date(stats.range.current.from).getDate()}–${new Date(stats.range.current.to).getMonth() + 1}/${new Date(stats.range.current.to).getDate()}`,
                previousRange: `${new Date(stats.range.previous.from).getMonth() + 1}/${new Date(stats.range.previous.from).getDate()}–${new Date(stats.range.previous.to).getMonth() + 1}/${new Date(stats.range.previous.to).getDate()}`,
                assignmentCount: stats.assignmentCount,
                submissionRate: stats.submissionRate,
                correctRate: stats.correctRate,
                weakKps: stats.weakKps,
                trendDelta: stats.trendDelta,
                errorTags: stats.errorTags,
                attentionStudents: stats.attentionStudents,
                tierDistribution: stats.tierDistribution,
              }),
            },
          ],
          { task: "report", maxTokens: 4096 }
        );
        const title = typeof g.title === "string" && g.title.trim() ? g.title.trim() : report.title;
        const summary =
          typeof g.summary === "string" && g.summary.trim() ? g.summary.trim() : report.summary;
        const suggestions = Array.isArray(g.suggestions)
          ? g.suggestions
              .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              .map((s) => s.trim())
              .slice(0, 8)
          : [];
        report = {
          title,
          summary,
          suggestions: suggestions.length ? suggestions : report.suggestions,
        };
        aiGenerated = true;
      } catch (e) {
        console.warn("[weekly-report] AI 生成失败，使用模板兜底:", e);
      }
    }

    return ok({ report: { ...report, aiGenerated, generatedAt: new Date().toISOString() }, stats });
  } catch (e) {
    return fail(e);
  }
}
