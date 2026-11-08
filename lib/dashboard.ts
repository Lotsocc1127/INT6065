/**
 * 班级看板聚合（从 app/api/teacher/dashboard/route.ts 抽出）：
 * 看板接口与 Excel 导出共用同一套聚合，保证两处数据口径一致。
 * 响应形状与抽取前逐字段相同（e2e 组 9/17 依赖）。
 */
import { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { parseArr } from "./json";
import { avg, tierOf, type Tier } from "./mastery";
import { effectiveTierOf } from "./tier";

export interface DashboardDto {
  subject: { code: string; name: string };
  class: { id: string; name: string };
  classes: { id: string; name: string }[];
  kps: { id: string; code: string; name: string; classAvg: number }[];
  students: {
    id: string;
    name: string;
    studentNo: string | null;
    avg: number;
    tier: Tier;
    tierAuto: Tier;
    tierOverride: string | null;
    values: Record<string, number>;
  }[];
  tiers: Record<Tier, { id: string; name: string; studentNo: string | null }[]>;
  stats: {
    classAvg: number;
    proficient: number;
    weakKpCodes: string[];
    assignmentCount: number;
    submissionRate: number;
  };
  trend: { date: string; avg: number }[];
  trendDelta: number;
  errorTags: { tag: string; count: number }[];
}

export type DashboardResult = { ok: true; dto: DashboardDto } | { ok: false; error: string };

export async function aggregateDashboard(opts: {
  subjectCode: string;
  classId?: string;
  /** 可见班级白名单（班主任权限）：过滤 DTO 的 classes 并拦截越界 classId */
  visibleClassIds?: string[];
}): Promise<DashboardResult> {
  // 互不依赖的查询并行：科目 + 班级（4 个并发以内，Neon Pooled 可承受）
  const [subject, allClasses] = await Promise.all([
    prisma.subject.findUnique({
      where: { code: opts.subjectCode },
      select: { id: true, code: true, name: true },
    }),
    prisma.class.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!subject) return { ok: false, error: "科目不存在" };

  const classes = opts.visibleClassIds
    ? allClasses.filter((c) => opts.visibleClassIds!.includes(c.id))
    : allClasses;
  const cls = opts.classId ? classes.find((c) => c.id === opts.classId) : classes[0];
  if (!cls) return { ok: false, error: "没有班级数据" };

  const [kps, students] = await Promise.all([
    prisma.knowledgePoint.findMany({
      where: { subjectId: subject.id },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    // 只取看板需要的字段：不要整行 User（含密码哈希）回传
    prisma.user.findMany({
      where: { role: Role.STUDENT, classId: cls.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, studentNo: true, tierOverride: true },
    }),
  ]);
  const studentIds = students.map((s) => s.id);

  // 依赖 students/subject/class 的四条查询并行
  const [masteries, assignments, points, records] = await Promise.all([
    prisma.mastery.findMany({
      where: { subjectId: subject.id, studentId: { in: studentIds } },
      select: { studentId: true, kpId: true, value: true },
    }),
    prisma.assignment.findMany({
      where: { subjectId: subject.id, classId: cls.id },
      select: { id: true, _count: { select: { submissions: true } } },
    }),
    // 趋势只需要 value/at；按时间升序供按天分桶
    prisma.masteryPoint.findMany({
      where: { mastery: { subjectId: subject.id, studentId: { in: studentIds } } },
      orderBy: { at: "asc" },
      select: { value: true, at: true },
    }),
    prisma.answerRecord.findMany({
      where: { studentId: { in: studentIds }, question: { subjectId: subject.id } },
      select: { errorTags: true },
    }),
  ]);

  const masteryByStudent = new Map<string, Map<string, number>>();
  for (const m of masteries) {
    if (!masteryByStudent.has(m.studentId)) masteryByStudent.set(m.studentId, new Map());
    masteryByStudent.get(m.studentId)!.set(m.kpId, m.value);
  }

  // 学生平均掌握度 + 分层（有效分层 = 教师锁定 ?? 自动判定）
  const studentRows = students.map((s) => {
    const map = masteryByStudent.get(s.id) ?? new Map();
    const values = kps.map((k) => map.get(k.id) ?? 0);
    const avgV = avg(values);
    return {
      id: s.id,
      name: s.name,
      studentNo: s.studentNo,
      avg: avgV,
      tier: effectiveTierOf(avgV, s.tierOverride),
      tierAuto: tierOf(avgV),
      tierOverride: s.tierOverride,
      values,
    };
  });

  const kpClassAvg = kps.map((k, i) => avg(studentRows.map((r) => r.values[i])));
  // 按 id 聚合（重名时姓名不可作键/反查依据）
  const tiers: Record<Tier, { id: string; name: string; studentNo: string | null }[]> = {
    foundation: [],
    intermediate: [],
    advanced: [],
  };
  for (const r of studentRows) tiers[r.tier].push({ id: r.id, name: r.name, studentNo: r.studentNo });

  // 空班级（无学生）时提交率为 0，避免 0/0 产生 NaN/Infinity 进入看板与导出
  const submissionRate =
    assignments.length && students.length
      ? avg(assignments.map((a) => a._count.submissions / students.length))
      : 0;

  // 班级掌握度趋势：按天聚合 MasteryPoint 历史
  const dayBuckets = new Map<string, number[]>();
  for (const p of points) {
    const d = new Date(p.at);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    if (!dayBuckets.has(key)) dayBuckets.set(key, []);
    dayBuckets.get(key)!.push(p.value);
  }
  const trend = [...dayBuckets.entries()].map(([date, vals]) => ({ date, avg: avg(vals) }));
  const trendDelta = trend.length >= 2 ? trend[trend.length - 1].avg - trend[0].avg : 0;

  // 高频错因：全班该科目 AnswerRecord.errorTags 聚合
  const tagCount = new Map<string, number>();
  for (const r of records) {
    for (const t of parseArr(r.errorTags)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  }
  const errorTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));

  return {
    ok: true,
    dto: {
      subject: { code: subject.code, name: subject.name },
      class: { id: cls.id, name: cls.name },
      classes: classes.map((c) => ({ id: c.id, name: c.name })),
      kps: kps.map((k, i) => ({ id: k.id, code: k.code, name: k.name, classAvg: kpClassAvg[i] })),
      students: studentRows.map((r) => ({
        id: r.id,
        name: r.name,
        studentNo: r.studentNo,
        avg: r.avg,
        tier: r.tier,
        tierAuto: r.tierAuto,
        tierOverride: r.tierOverride,
        values: Object.fromEntries(kps.map((k, i) => [k.id, r.values[i]])),
      })),
      tiers,
      stats: {
        classAvg: avg(studentRows.map((r) => r.avg)),
        proficient: studentRows.filter((r) => r.avg >= 0.8).length,
        weakKpCodes: kps.filter((_, i) => kpClassAvg[i] < 0.6).map((k) => k.code),
        assignmentCount: assignments.length,
        submissionRate: Math.round(submissionRate * 100),
      },
      trend,
      trendDelta,
      errorTags,
    },
  };
}
