import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { aggregateWeeklyReport } from "@/lib/weekly-report";
import { fillSheet, xlsxResponse } from "@/lib/export";
import { TIER_META, type Tier } from "@/lib/mastery";
import { formatStudent, pct } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/export/weekly-report?subject=&classId= —— 班级学情周报 Excel 导出（数据口径同 lib/weekly-report.ts） */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const subject = await prisma.subject.findUnique({ where: { code: sp.get("subject") ?? "math" } });
    if (!subject) return ok({ error: "科目不存在" }, 404);

    const classes = await prisma.class.findMany({ orderBy: { name: "asc" } });
    const cls = sp.get("classId")
      ? classes.find((c) => c.id === sp.get("classId"))
      : classes[0];
    if (!cls) return ok({ error: "没有班级数据" }, 404);

    const stats = await aggregateWeeklyReport({
      subjectId: subject.id,
      subjectName: subject.name,
      classId: cls.id,
      className: cls.name,
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "智学慧教";

    // 1. 对比数据
    const ws1 = wb.addWorksheet("对比数据");
    fillSheet(
      ws1,
      ["指标", "本期", "上期"],
      [
        ["布置作业", stats.assignmentCount.current, stats.assignmentCount.previous],
        ["提交率", stats.submissionRate.current == null ? "无数据" : pct(stats.submissionRate.current), stats.submissionRate.previous == null ? "无数据" : pct(stats.submissionRate.previous)],
        ["平均正确率", stats.correctRate.current == null ? "无数据" : pct(stats.correctRate.current), stats.correctRate.previous == null ? "无数据" : pct(stats.correctRate.previous)],
        ["两周掌握度趋势", `${stats.trendDelta >= 0 ? "上升" : "下降"} ${pct(Math.abs(stats.trendDelta))}`, "—"],
      ]
    );

    // 2. 薄弱知识点
    const ws2 = wb.addWorksheet("薄弱知识点");
    fillSheet(
      ws2,
      ["知识点编号", "知识点", "班级平均掌握度"],
      stats.weakKps.map((k) => [k.code, k.name, pct(k.classAvg)])
    );

    // 3. 掌握度趋势
    const ws3 = wb.addWorksheet("掌握度趋势");
    fillSheet(
      ws3,
      ["日期", "平均掌握度"],
      stats.masteryTrend.map((t) => [t.date, pct(t.avg)])
    );

    // 4. 高频错因
    const ws4 = wb.addWorksheet("高频错因");
    fillSheet(ws4, ["错因标签", "次数"], stats.errorTags.map((t) => [t.tag, t.count]));

    // 5. 关注学生
    const ws5 = wb.addWorksheet("关注学生");
    fillSheet(
      ws5,
      ["学生", "平均掌握度", "近 7 天趋势", "关注原因"],
      stats.attentionStudents.map((s) => [
        formatStudent(s.name, s.studentNo),
        pct(s.avg),
        s.trendDelta == null ? "数据不足" : `${s.trendDelta >= 0 ? "+" : ""}${pct(s.trendDelta)}`,
        s.reasons.join("；"),
      ])
    );

    // 6. 分层分布
    const ws6 = wb.addWorksheet("分层分布");
    fillSheet(
      ws6,
      ["层级", "人数"],
      (Object.keys(stats.tierDistribution) as Tier[]).map((t) => [
        TIER_META[t].label,
        stats.tierDistribution[t],
      ])
    );

    return await xlsxResponse(wb, `${cls.name}-${subject.name}学情周报.xlsx`);
  } catch (e) {
    return fail(e);
  }
}
