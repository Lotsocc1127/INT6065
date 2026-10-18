/**
 * 课堂讲评数据层：全班逐题作答聚合（教师投影讲评用）。
 * 典型错误作答脱敏——只带学号（studentNo），不带姓名；学生数组按提交时间升序，样例取最早的前 5 条。
 */
import { prisma } from "./prisma";
import { parseArr } from "./json";
import { avg, tierOf, type Tier } from "./mastery";
import { effectiveTierOf, TIERS } from "./tier";

export interface LectureQuestionStats {
  /** 本题作答数 */
  total: number;
  correct: number;
  wrong: number;
  /** 待批改（score 为 null） */
  pending: number;
  /** 已批改得分均值（0-1）；全部未批改为 null */
  scoreRate: number | null;
  avgTimeMs: number | null;
  errorTags: { tag: string; count: number }[];
  tierBreakdown: { tier: Tier; total: number; wrong: number }[];
  /** 仅选择题：A..N 全字母人数（含 0，图表稳定）；非选择题为 null */
  optionDist: { option: string; count: number }[] | null;
  /** 典型错误作答（脱敏：只带学号），cap 5 */
  wrongSamples: { studentNo: string | null; response: string; score: number | null }[];
}

export interface LectureQuestion {
  id: string;
  order: number;
  type: string;
  difficulty: number;
  stem: string;
  options: string[];
  answer: string;
  analysis: string | null;
  kpCodes: string[];
  tier: string | null;
  stats: LectureQuestionStats;
}

export interface LectureData {
  assignment: {
    id: string;
    title: string;
    type: string;
    subjectCode: string;
    subjectName: string;
    className: string;
    dueAt: Date | null;
    createdAt: Date;
  };
  /** 按错误数降序、得分率升序（null 靠后）排序——讲评从最难的题开始 */
  questions: LectureQuestion[];
}

const OPTION_LETTERS = "ABCDEFGHIJKLMN";

export async function buildLectureData(assignmentId: string): Promise<LectureData | null> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      subject: true,
      class: true,
      questions: { include: { question: true }, orderBy: { order: "asc" } },
    },
  });
  if (!assignment) return null;

  const submissions = await prisma.submission.findMany({
    where: { assignmentId: assignment.id },
    include: { student: true, answers: true },
    orderBy: { submittedAt: "asc" },
  });

  // 学生分层一次算好（有效分层 = 教师锁定 ?? 该科掌握度均值判定），避免逐题 N+1
  const studentIds = submissions.map((s) => s.studentId);
  const masteries = await prisma.mastery.findMany({
    where: { subjectId: assignment.subjectId, studentId: { in: studentIds } },
  });
  const masteryByStudent = new Map<string, number[]>();
  for (const m of masteries) {
    const list = masteryByStudent.get(m.studentId) ?? [];
    list.push(m.value);
    masteryByStudent.set(m.studentId, list);
  }
  const tierByStudent = new Map<string, Tier>();
  for (const s of submissions) {
    const values = masteryByStudent.get(s.studentId) ?? [];
    tierByStudent.set(s.studentId, effectiveTierOf(values.length ? avg(values) : 0, s.student.tierOverride));
  }

  // 知识点编号（题卡徽章显示用）
  const kpIds = [...new Set(assignment.questions.flatMap((aq) => parseArr(aq.question.kpIds)))];
  const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: kpIds } } });
  const kpById = new Map(kps.map((k) => [k.id, k]));

  const questions: LectureQuestion[] = assignment.questions.map((aq) => {
    const q = aq.question;
    // 本题全部作答（含作答学生信息，用于分层拆分与脱敏样例）
    const rows = submissions.flatMap((s) =>
      s.answers
        .filter((a) => a.questionId === q.id)
        .map((a) => ({ a, stu: s.student }))
    );
    const scored = rows.map((r) => r.a.score).filter((v): v is number => v != null);
    const times = rows.map((r) => r.a.timeSpentMs).filter((v): v is number => v != null);

    const tagCount = new Map<string, number>();
    for (const r of rows) for (const t of parseArr(r.a.errorTags)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);

    const breakdown: Record<Tier, { total: number; wrong: number }> = {
      foundation: { total: 0, wrong: 0 },
      intermediate: { total: 0, wrong: 0 },
      advanced: { total: 0, wrong: 0 },
    };
    for (const r of rows) {
      const b = breakdown[tierByStudent.get(r.stu.id) ?? tierOf(0)];
      b.total += 1;
      if (r.a.isCorrect === false) b.wrong += 1;
    }

    const options = parseArr<string>(q.options);
    const optionDist =
      q.type === "SINGLE_CHOICE"
        ? [...OPTION_LETTERS.slice(0, options.length)].map((letter) => ({
            option: letter,
            count: rows.filter((r) => r.a.response.trim().toUpperCase() === letter).length,
          }))
        : null;

    const wrongRows = rows.filter(
      (r) => r.a.isCorrect === false || (r.a.score != null && r.a.score < 0.6)
    );

    return {
      id: q.id,
      order: aq.order,
      type: q.type,
      difficulty: q.difficulty,
      stem: q.stem,
      options,
      answer: q.answer,
      analysis: q.analysis,
      kpCodes: parseArr(q.kpIds)
        .map((id) => kpById.get(id)?.code)
        .filter(Boolean) as string[],
      tier: aq.tier,
      stats: {
        total: rows.length,
        correct: rows.filter((r) => r.a.isCorrect === true).length,
        wrong: rows.filter((r) => r.a.isCorrect === false).length,
        pending: rows.filter((r) => r.a.score == null).length,
        scoreRate: scored.length ? avg(scored) : null,
        avgTimeMs: times.length ? avg(times) : null,
        errorTags: [...tagCount.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([tag, count]) => ({ tag, count })),
        tierBreakdown: TIERS.map((t) => ({ tier: t, ...breakdown[t] })),
        optionDist,
        wrongSamples: wrongRows.slice(0, 5).map((r) => ({
          studentNo: r.stu.studentNo,
          response: r.a.response,
          score: r.a.score,
        })),
      },
    };
  });

  // 讲评顺序：错误数降序 → 得分率升序（null 靠后）→ 保持原题序
  questions.sort((a, b) => {
    if (b.stats.wrong !== a.stats.wrong) return b.stats.wrong - a.stats.wrong;
    if ((a.stats.scoreRate ?? -1) !== (b.stats.scoreRate ?? -1)) {
      return (a.stats.scoreRate ?? -1) - (b.stats.scoreRate ?? -1);
    }
    return a.order - b.order;
  });

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      type: assignment.type,
      subjectCode: assignment.subject.code,
      subjectName: assignment.subject.name,
      className: assignment.class.name,
      dueAt: assignment.dueAt,
      createdAt: assignment.createdAt,
    },
    questions,
  };
}

export interface LectureItem {
  questionId: string;
  angle: string;
  pitfalls: string[];
  variant: string;
}

/** 讲评要点模板兜底：不依赖 LLM，基于逐题统计生成（保证无 Key 时也有可用内容） */
export function buildLectureFallback(questions: LectureQuestion[]): LectureItem[] {
  return questions.map((q) => {
    const s = q.stats;
    const pitfalls: string[] = [];
    if (s.scoreRate != null && s.scoreRate < 0.6) {
      pitfalls.push(`本题得分率仅 ${Math.round(s.scoreRate * 100)}%，多数学生未能完整作答`);
    } else if (s.wrong > 0) {
      pitfalls.push(`本题 ${s.wrong} 人答错，注意核对易错环节`);
    }
    for (const t of s.errorTags.slice(0, 2)) {
      pitfalls.push(`高频错因「${t.tag}」（${t.count} 次），讲解时重点辨析`);
    }
    if (s.pending > 0) pitfalls.push(`仍有 ${s.pending} 人待批改，讲评前建议先完成批改`);
    return {
      questionId: q.id,
      angle: `从「${q.kpCodes.join("、") || "本题"}」知识点切入，先让学生复述题意与解题思路，再对照标准答案核对关键步骤`,
      pitfalls: pitfalls.length ? pitfalls : ["结合本题统计与典型错误，讲解时引导学生自查作答过程"],
      variant: "变式提问：改变题目条件后请学生重做并讲出思路",
    };
  });
}
