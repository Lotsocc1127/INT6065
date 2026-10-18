import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { aggregateDashboard } from "@/lib/dashboard";
import { fillSheet, xlsxResponse } from "@/lib/export";
import { TIER_META } from "@/lib/mastery";
import { pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** GET /api/export/dashboard?subject=&classId= —— 班级看板 Excel 导出（与看板接口同口径，见 lib/dashboard.ts） */
export async function GET(req: NextRequest) {
  try {
    await requireApiUser(["TEACHER", "ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const res = await aggregateDashboard({
      subjectCode: sp.get("subject") ?? "math",
      classId: sp.get("classId") ?? undefined,
    });
    if (!res.ok) return ok({ error: res.error }, 404);
    const d = res.dto;

    const wb = new ExcelJS.Workbook();
    wb.creator = "智学慧教";

    // 1. 掌握度矩阵（学生 × 知识点）
    const ws1 = wb.addWorksheet("掌握度矩阵");
    fillSheet(
      ws1,
      ["学号", "姓名", "分层", "平均掌握度", ...d.kps.map((k) => `${k.code} ${k.name}`)],
      d.students.map((s) => [
        s.studentNo ?? "—",
        s.name,
        TIER_META[s.tier].label,
        pct(s.avg),
        ...d.kps.map((k) => pct(s.values[k.id] ?? 0)),
      ])
    );

    // 2. 错因汇总
    const ws2 = wb.addWorksheet("错因汇总");
    fillSheet(ws2, ["错因标签", "次数"], d.errorTags.map((t) => [t.tag, t.count]));

    // 3. 分层名单
    const ws3 = wb.addWorksheet("分层名单");
    const tierRows: (string | number | null)[][] = [];
    for (const t of ["foundation", "intermediate", "advanced"] as const) {
      const list = d.tiers[t];
      if (list.length) {
        tierRows.push([TIER_META[t].label, ...list.map((s) => (s.studentNo ? `${s.name}（${s.studentNo}）` : s.name))]);
      }
    }
    const maxTierLen = Math.max(1, ...tierRows.map((r) => r.length));
    fillSheet(
      ws3,
      ["层级", ...Array.from({ length: maxTierLen - 1 }, (_, i) => `学生 ${i + 1}`)],
      tierRows
    );

    // 4. 班级统计
    const ws4 = wb.addWorksheet("班级统计");
    fillSheet(
      ws4,
      ["指标", "数值"],
      [
        ["班级平均掌握度", pct(d.stats.classAvg)],
        ["达标人数（≥80%）", d.stats.proficient],
        ["薄弱知识点", d.stats.weakKpCodes.join("、") || "无"],
        ["作业数", d.stats.assignmentCount],
        ["平均提交率", `${d.stats.submissionRate}%`],
      ]
    );

    return await xlsxResponse(wb, `${d.class.name}-${d.subject.name}看板.xlsx`);
  } catch (e) {
    return fail(e);
  }
}
