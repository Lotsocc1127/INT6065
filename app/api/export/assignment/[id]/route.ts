import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { loadTeacherSubmissions } from "@/lib/assignment-detail";
import { fillSheet, xlsxResponse } from "@/lib/export";
import { fmtDuration, pct } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/export/assignment/:id —— 作业成绩单 Excel 导出（行=学生，列=各题得分/对错/错因） */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        subject: true,
        class: true,
        questions: { include: { question: true }, orderBy: { order: "asc" } },
      },
    });
    if (!assignment) return ok({ error: "作业不存在" }, 404);

    const subs = await loadTeacherSubmissions(assignment.id);
    const questions = assignment.questions.map((aq) => aq.question);

    const headers = ["学号", "姓名"];
    for (let i = 0; i < questions.length; i++) {
      headers.push(`第${i + 1}题得分`, `第${i + 1}题对错`, `第${i + 1}题错因`);
    }
    headers.push("得分率", "总用时");

    const rows = subs.map((s) => {
      const row: (string | number | null)[] = [s.studentNo ?? "—", s.studentName];
      const byQ = new Map(s.answers.map((a) => [a.questionId, a]));
      for (const q of questions) {
        const a = byQ.get(q.id);
        row.push(
          a?.score == null ? "待批改" : pct(a.score, 1),
          a?.isCorrect == null ? "待批改" : a.isCorrect ? "正确" : "错误",
          a?.errorTags.length ? a.errorTags.join("、") : "—"
        );
      }
      const totalMs = s.answers.reduce((acc, a) => acc + (a.timeSpentMs ?? 0), 0);
      row.push(s.avgScore == null ? "待批改" : pct(s.avgScore, 1), fmtDuration(totalMs));
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
