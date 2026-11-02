import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { Role } from "@prisma/client";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { loadTeacherSubmissions } from "@/lib/assignment-detail";
import { fillSheet, xlsxResponse } from "@/lib/export";
import { fmtDuration, pct } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { assertTeacherCanAccessAssignment } from "@/lib/teacher-scope";
import { avg, type Tier } from "@/lib/mastery";
import { effectiveTierOf } from "@/lib/tier";

export const dynamic = "force-dynamic";

/** GET /api/export/assignment/:id —— 作业成绩单 Excel 导出（行=学生，列=各题得分/对错/错因）
 * 权限：班主任限本班、科目教师限本学科（越界 403）。
 * 分层作业：只导出每个学生被分到的题（未分到 → 「—」，避免全排列出「待批改」假象）。 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["TEACHER", "ADMIN"]);
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        subject: true,
        class: true,
        questions: { include: { question: true }, orderBy: { order: "asc" } },
      },
    });
    if (!assignment) return ok({ error: "作业不存在" }, 404);
    assertTeacherCanAccessAssignment(session.user, {
      classId: assignment.classId,
      subjectId: assignment.subjectId,
    });

    const subs = await loadTeacherSubmissions(assignment.id);
    const aqs = assignment.questions; // 含 tier（分层作业）

    // 批量计算全班学生有效分层（预读 + 本地聚合，避免逐生 N+1 查询）
    const studentIds = subs.map((s) => s.studentId);
    const [stuRows, masteryRows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: studentIds }, role: Role.STUDENT },
        select: { id: true, tierOverride: true },
      }),
      prisma.mastery.findMany({
        where: { studentId: { in: studentIds }, subjectId: assignment.subjectId },
        select: { studentId: true, value: true },
      }),
    ]);
    const valuesByStudent = new Map<string, number[]>();
    for (const m of masteryRows) {
      if (!valuesByStudent.has(m.studentId)) valuesByStudent.set(m.studentId, []);
      valuesByStudent.get(m.studentId)!.push(m.value);
    }
    const tierOf = new Map<string, Tier>();
    for (const stu of stuRows) {
      const vals = valuesByStudent.get(stu.id) ?? [];
      tierOf.set(stu.id, effectiveTierOf(vals.length ? avg(vals) : 0, stu.tierOverride));
    }

    const headers = ["学号", "姓名"];
    for (let i = 0; i < aqs.length; i++) {
      headers.push(`第${i + 1}题得分`, `第${i + 1}题对错`, `第${i + 1}题错因`);
    }
    headers.push("得分率", "总用时", "待复核题数");

    const rows = subs.map((s) => {
      const row: (string | number | null)[] = [s.studentNo ?? "—", s.studentName];
      const byQ = new Map(s.answers.map((a) => [a.questionId, a]));
      const stuTier = tierOf.get(s.studentId);
      let needsReview = 0;
      for (const aq of aqs) {
        // 分层：该题不属于该生层级 → 未布置，标「—」（与看板/学生端可见题目一致）
        const assigned = !aq.tier || aq.tier === stuTier;
        const a = assigned ? byQ.get(aq.questionId) : undefined;
        if (!assigned) {
          row.push("—", "—", "—");
          continue;
        }
        if (a?.reviewStatus === "needs_review") needsReview++;
        row.push(
          a?.score == null ? "待批改" : pct(a.score, 1),
          a == null
            ? "未提交"
            : a.reviewStatus === "needs_review"
              ? "待复核"
              : a.isCorrect == null
                ? "待批改"
                : a.isCorrect
                  ? "正确"
                  : "错误",
          a?.errorTags.length ? a.errorTags.join("、") : "—"
        );
      }
      const totalMs = s.answers.reduce((acc, a) => acc + (a.timeSpentMs ?? 0), 0);
      row.push(s.avgScore == null ? "待批改" : pct(s.avgScore, 1), fmtDuration(totalMs));
      row.push(needsReview > 0 ? needsReview : "—");
      return row;
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "智学慧教";
    const ws = wb.addWorksheet("成绩单");
    fillSheet(ws, headers, rows);

    return await xlsxResponse(
      wb,
      `${assignment.class.name}-${assignment.subject.name}-${assignment.title}.xlsx`
    );
  } catch (e) {
    return fail(e);
  }
}
