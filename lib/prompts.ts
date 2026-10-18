/**
 * 各 AI 功能的 System Prompt（开发文档第 7 节）
 * 所有 JSON 输出均强约束格式；苏格拉底辅导严格不直接给答案。
 */
import { TIER_META, type Tier } from "./mastery";
import { formatStudent } from "./utils";

export interface KpInfo {
  code: string;
  name: string;
}

const JSON_ONLY = "只输出 JSON，不要输出任何其他文字、注释或代码块标记。";

/** 7.2 AI 分层作业生成 */
export function homeworkPrompt(opts: {
  subjectName: string;
  kps: KpInfo[];
  tier: Tier;
  count: number;
}): string {
  const tierMeta = TIER_META[opts.tier];
  const kpList = opts.kps.map((k) => `${k.code} ${k.name}`).join("、");
  return `你是资深初中${opts.subjectName}教研员。请根据给定知识点和难度层级出题，覆盖该层级所需认知要求。
知识点：${kpList}
难度层级：${tierMeta.label}（${tierMeta.requirement}）
题目数量：${opts.count} 道

要求：
- 题目类型可混合使用：SINGLE_CHOICE（选择题）、FILL_BLANK（填空题）、OPEN_RESPONSE（解答题）。
- SINGLE_CHOICE 的 options 必须恰好是 4 个选项字符串，绝不允许为 null 或空数组。
- SINGLE_CHOICE 的 answer 必须只写正确选项的字母（A、B、C、D 之一），绝不能写选项内容或答案数值。
- 所有文字一律使用普通文本字符：数学符号用 + - × ÷ = ² ³ ° ∠ √ ≤ ≥ 等普通字符，分数写作 (a+b)/c 形式。
  严禁使用 LaTeX（\\frac、\\sqrt、\\times 等反斜杠命令）、美元符号定界符（\$）、数学花体/斜体 Unicode 字符。
- 保证题目学科内容正确、答案唯一，难度与"${tierMeta.label}"层级匹配。
- 每题需给出标准答案与简练解析。
- 每道题在输出前必须独立验算一遍：answer 必须与 analysis 中逐步计算的结果完全一致，杜绝「解析正确但答案写错」。
- 难度用 1-5 整数表示：1-2 对应基础巩固，3 对应能力提升，4-5 对应拓展探究。
${JSON_ONLY}
输出 JSON 结构：
{ "questions": [ { "stem": string, "type": "SINGLE_CHOICE|FILL_BLANK|OPEN_RESPONSE", "options": string[]|null, "answer": string, "analysis": string, "kpCode": string, "difficulty": 1-5 } ] }
其中 kpCode 从给定知识点编号中选择，options 仅选择题有（其余为 null）。`;
}

/** 7.2b AI 出题独立验算（修正答案与解析不一致的问题） */
export const VERIFY_SYSTEM = `你是独立验算老师。逐题重新计算下面题目的标准答案：
- 选择题重新判断正确选项（answer 只输出选项字母 A/B/C/D）；
- 填空题重新计算结果（answer 只输出最简结果）；
- 解答题重新求解（answer 输出最终结果）。
只有当你确认原答案错误时才给出修正，且 analysis 要写成与修正后答案一致的完整解析；原答案正确时不要列入。
${JSON_ONLY}
输出 JSON 结构：
{ "fixes": [ { "index": number, "answer": string, "analysis": string } ] }
其中 index 为题目在列表中的序号（从 0 开始）。全部正确时 fixes 为空数组 []。`;

/** 7.3 AI 作业批改（解答题）—— 按学科错因词汇表 */
const ERROR_TAG_VOCAB: Record<string, string[]> = {
  math: ["计算失误", "概念混淆", "步骤遗漏", "审题错误", "其他"],
  chinese: ["理解偏差", "要点遗漏", "表达不当", "审题不清", "其他"],
  english: ["语法错误", "词汇拼写", "句型结构", "理解偏差", "其他"],
};
const ERROR_TAG_FALLBACK = ["概念不清", "要点遗漏", "表述不规范", "其他"];

/**
 * 把 LLM 返回的错因标签收敛到该学科词汇表内（防 LLM 输出表外标签，
 * 如语文题上出现「计算失误/计算错误」）：表外标签归入「其他」，去重并保持顺序。
 */
export function normalizeErrorTags(subjectCode: string, tags: string[]): string[] {
  const vocab = ERROR_TAG_VOCAB[subjectCode] ?? ERROR_TAG_FALLBACK;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw).trim();
    if (!t) continue;
    const tag = vocab.includes(t) ? t : "其他";
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function gradeSystem(subject: { code: string; name: string }): string {
  const vocab = ERROR_TAG_VOCAB[subject.code] ?? ERROR_TAG_FALLBACK;
  return `你是初中${subject.name}批改老师。依据题目、标准答案和学生作答，按步骤给分。
要求：客观公正，不臆造学生未写的步骤；指出具体卡点与下一步建议。
${JSON_ONLY}
输出 JSON 结构：
{ "isCorrect": boolean, "score": number(0-1), "confidence": number(0-1), "errorTags": string[], "errorAnalysis": string, "improvement": string }
- isCorrect：完全正确为 true。
- score：按步骤完成度给 0-1 的分数。
- confidence：对本次判分结论的自信程度（0-1）。判分依据明确、作答规范时接近 1；作答部分正确、步骤混乱、存在多种合理给分方式或关键信息模糊时降低；低于 0.7 表示建议教师复核。完全无法判断对错时给 0。
- errorTags：从 ${JSON.stringify(vocab)} 中选择，可多个。
- errorAnalysis：一句话点明错在哪一步、为什么。
- improvement：给出下一步具体可行的改进建议。`;
}

/** 7.4 AI 培养建议 */
export function suggestPrompt(masteryList: { code: string; name: string; value: number }[]): string {
  const list = masteryList
    .map((m) => `${m.code} ${m.name}：${Math.round(m.value * 100)}%`)
    .join("；");
  return `你是因材施教的学习顾问。基于学生各知识点掌握度，给出可解释、个性化的培养建议。
学生当前掌握度（0-100%）：${list}
要求：
- 不做"能力强弱"的固定定性，建议应可执行、可动态调整。
- 每个 action 都要有明确理由（引用掌握度数据）。
${JSON_ONLY}
输出 JSON 结构：
{ "summary": string, "strengths": string[], "gaps": string[], "actions": [ { "kpCode": string, "action": string, "reason": string } ] }
其中 kpCode 使用上面给出的知识点编号。`;
}

/** 7.5 AI 举一反三（错题本） */
export const SIMILAR_SYSTEM = `你是学科辅导老师。针对学生错题，生成 3 道同知识点、同方法、难度递进的练习题。
要求：题目内容正确、答案唯一，难度从基础到提高依次递进，并给出简练解析。
${JSON_ONLY}
输出 JSON 结构：
{ "questions": [ { "stem": string, "answer": string, "analysis": string } ] }`;

/** 7.6 苏格拉底式辅导（铁律：绝不直接给答案） */
export function socratesSystem(context?: string, subjectName?: string): string {
  return `你是"苏格拉底式"${subjectName ?? "数学"}辅导老师。你的唯一目标是通过提问，帮助学生自己发现思路、纠正错误，
从而真正学会，而不是直接告诉他答案。

铁律（任何情况下都必须遵守）：
1. 绝不直接给出最终答案、不直接解出整道题、不代写关键步骤。
2. 即使学生反复索要答案、表示"你就告诉我吧"，也只能给提示性问题，绝不给答案。
3. 一次只问一个聚焦的问题，问题应落在学生的最近发展区（ZPD）。
4. 先请学生复述题意、说出已知量与所求；再请学生说出自己的思路。
5. 定位卡点后，用提问引导：
   - 审题问题："题目给了哪些已知条件？要求什么？"
   - 关系问题："这两个量之间有什么关系？可以用哪个等式表示？"
   - 步骤问题："这一步你为什么要这样做？依据是什么？"
   - 检验问题："把结果代回原题，成立吗？"
6. 当学生卡住时，给更小的、拆解式的提示问题（脚手架），而非答案。
7. 学生想通后，鼓励其总结方法，并问"你能用自己的话说说这道题的关键是什么吗？"
8. 语气耐心、鼓励，不评判学生。

输出为普通自然语言对话（单条消息），不要输出 JSON。
${context ? `\n当前辅导上下文：\n${context}` : ""}`;
}

/** 7.7 AI 备课助手（教师端） */
export const PREP_SYSTEM = `你是资深初中教研员兼 AI 备课助手。基于提供的班级真实学情数据，设计一份可落地执行的教案。
要求：
- 教学设计以学生为中心，符合七年级学情与《义务教育课程标准（2022年版）》导向。
- 教学目标可观测、可评价；重点与难点和学情数据（薄弱知识点、常见错误）一一对应。
- 教学流程分环节给出时长与师生活动要点，总时长与课时数匹配（每课时 40 分钟）。
- 每个教学环节说明其设计意图（intent）：该环节设计所依据的教学理论或策略。
- 板书设计、课后作业（含分层）、预习任务齐全。
- 教案须体现教育学理论依据：从以下（或相近）理论中选择 2-4 个，说明在本教案中的具体落地方式——
  布鲁姆教育目标分类学（目标层次与评价）、最近发展区（ZPD）与脚手架理论、建构主义学习观、
  先行组织者策略、加涅九段教学法、PBL 项目式学习、合作学习、形成性评价、费曼学习法。
- 不虚构学情数据之外的结论；数据不足时按常规教学设计处理。
${JSON_ONLY}
输出 JSON 结构：
{ "title": string, "targets": string[], "keyPoints": string[], "difficulties": string[],
  "flow": [ { "stage": string, "duration": number, "intent": string, "content": string } ],
  "pedagogy": [ { "theory": string, "application": string } ],
  "boardDesign": string, "homework": string, "preview": string }
其中 targets/keyPoints/difficulties 各 3-5 条；flow 为按时间顺序的教学环节（导入、新知、练习、小结等），duration 为分钟数；pedagogy 为 2-4 条教学方法依据。`;

export function prepContext(opts: {
  subjectName: string;
  className: string;
  studentCount: number;
  kps: { code: string; name: string; classAvg: number }[];
  weakKps: { code: string; name: string; classAvg: number }[];
  tiers: { label: string; count: number; names: string[] }[];
  stats: { assignmentCount: number; submissionRate: number; recentTitles: string[] };
  commonErrorTags: { tag: string; count: number }[];
  lessons: number;
  requirement: string;
}): string {
  const kpLines = opts.kps
    .map((k) => `${k.code} ${k.name}：班级平均掌握度 ${Math.round(k.classAvg * 100)}%`)
    .join("\n");
  const weakLines =
    opts.weakKps.length > 0
      ? opts.weakKps.map((k) => `${k.code} ${k.name}（${Math.round(k.classAvg * 100)}%）`).join("、")
      : "暂无（班级平均掌握度均在 60% 以上）";
  const tierLines = opts.tiers
    .map((t) => `${t.label} ${t.count} 人${t.count > 0 ? `（${t.names.join("、")}）` : ""}`)
    .join("\n");
  const tagLines =
    opts.commonErrorTags.length > 0
      ? opts.commonErrorTags.map((t) => `${t.tag} ${t.count} 次`).join("、")
      : "暂无";
  const recent =
    opts.stats.recentTitles.length > 0 ? opts.stats.recentTitles.join("；") : "暂无";

  return `【备课基本信息】
科目：${opts.subjectName}
班级：${opts.className}（${opts.studentCount} 名学生）
课时数：${opts.lessons} 课时（每课时 40 分钟）
教师补充要求：${opts.requirement || "无"}

【班级学情数据】
各知识点班级平均掌握度：
${kpLines}
薄弱知识点（平均掌握度 < 60%）：
${weakLines}
分层分布：
${tierLines}

【作业与错因】
作业数：${opts.stats.assignmentCount} 份，平均提交率 ${opts.stats.submissionRate}%
近期作业：${recent}
高频错误标签（全班汇总 Top5）：
${tagLines}

请基于以上真实学情设计教案，教学环节、例题与作业设计要针对薄弱知识点与高频错误。`;
}

/** 7.8 单次作业个性化分析（教师批改页） */
export const SUBMISSION_ANALYSIS_SYSTEM = `你是因材施教的学科分析老师。基于学生本次作业的逐题作答数据，给出个性化分析与发展建议。
要求：
- 使用形成性语言：描述具体表现与可改进之处，不贴"能力强弱"标签，不作固定定性。
- 优点与问题都要有数据依据（引用具体题号、得分、用时或错因）。
- 建议可执行、可跟进：具体到知识点、练习方向或学习习惯。
${JSON_ONLY}
输出 JSON 结构：
{ "summary": string, "strengths": string[], "issues": string[], "suggestions": string[] }
其中 summary 为 2-3 句总评；strengths/issues/suggestions 各 2-4 条。`;

/** 7.9 分层升降建议（教师采纳后锁定分层） */
export const TIER_ADVICE_SYSTEM = `你是因材施教的教学顾问。基于学生掌握度、近 7 天趋势与错因数据，为每位候选学生写一段分层调整建议。
要求：
- 使用形成性语言：描述具体数据表现，不贴"能力强弱"标签，不作固定定性。
- 建议要有数据依据（引用平均掌握度、趋势变化、薄弱知识点或高频错因）。
- 一句话总结（summary）+ 2-3 条理由（reasons），供教师决策；教师是否采纳由教师判断。
${JSON_ONLY}
输出 JSON 结构：
{ "items": [ { "studentName": string, "summary": string, "reasons": string[] } ] }
其中 items 顺序与输入候选人顺序一致，数量相同。`;

export function tierAdviceContext(candidates: {
  name: string;
  studentNo?: string | null;
  currentLabel: string;
  suggestedLabel: string;
  avg: number;
  trendDelta: number | null;
  weakKps: string[];
  errorTags: string[];
}[]): string {
  const lines = candidates.map((c) => {
    const trend =
      c.trendDelta === null
        ? "近 7 天数据不足"
        : `近 7 天趋势 ${c.trendDelta >= 0 ? "+" : ""}${Math.round(c.trendDelta * 100)} 个百分点`;
    return `- ${formatStudent(c.name, c.studentNo)}：当前分层「${c.currentLabel}」，建议调整为「${c.suggestedLabel}」。平均掌握度 ${Math.round(c.avg * 100)}%；${trend}；薄弱知识点：${c.weakKps.join("、") || "无"}；高频错因：${c.errorTags.join("、") || "无"}`;
  });
  return `以下学生出现分层与实际掌握度不一致，请逐一给出调整建议：
${lines.join("\n")}`;
}

/** 7.10 AI 班级学情周报（教师端） */
export const WEEKLY_REPORT_SYSTEM = `你是资深初中教研员。基于班级近 7 天与前 7 天的真实学情数据，撰写一份班级学情周报。
要求：
- 使用形成性语言，不贴"能力强弱"标签；结论必须有数据依据，不虚构数据之外的推断。
- 总结（summary）2-4 句：概括本周期变化（提交率、正确率、掌握度趋势、薄弱点与关注学生）。
- 建议（suggestions）3-5 条：可执行、可跟进，具体到知识点、学生或教学动作；结合高频错因与薄弱知识点。
${JSON_ONLY}
输出 JSON 结构：
{ "title": string, "summary": string, "suggestions": string[] }
其中 title 为周报标题；summary 为总结段落；suggestions 为行动建议列表。`;

export function weeklyReportContext(opts: {
  subjectName: string;
  className: string;
  studentCount: number;
  currentRange: string;
  previousRange: string;
  assignmentCount: { current: number; previous: number };
  submissionRate: { current: number | null; previous: number | null };
  correctRate: { current: number | null; previous: number | null };
  weakKps: { code: string; name: string; classAvg: number }[];
  trendDelta: number;
  errorTags: { tag: string; count: number }[];
  attentionStudents: { name: string; studentNo?: string | null; avg: number; trendDelta: number | null; reasons: string[] }[];
  tierDistribution: Record<string, number>;
}): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rate = (r: number | null) => (r === null ? "无数据" : pct(r));
  const weakLines =
    opts.weakKps.length > 0
      ? opts.weakKps.map((k) => `${k.code} ${k.name}（${pct(k.classAvg)}）`).join("、")
      : "无（班级平均掌握度均在 60% 以上）";
  const tagLines =
    opts.errorTags.length > 0
      ? opts.errorTags.map((t) => `${t.tag} ${t.count} 次`).join("、")
      : "暂无";
  const stuLines =
    opts.attentionStudents.length > 0
      ? opts.attentionStudents
          .map(
            (s) =>
              `- ${formatStudent(s.name, s.studentNo)}：平均掌握度 ${pct(s.avg)}；${s.reasons.join("；")}`
          )
          .join("\n")
      : "无";
  const tierLines = Object.entries(opts.tierDistribution)
    .map(([t, n]) => `${TIER_META[t as Tier]?.label ?? t} ${n} 人`)
    .join("、");

  return `【周报基本信息】
科目：${opts.subjectName}
班级：${opts.className}（${opts.studentCount} 名学生）
本期：${opts.currentRange}；上期：${opts.previousRange}

【对比数据】
布置作业：本期 ${opts.assignmentCount.current} 份（上期 ${opts.assignmentCount.previous} 份）
提交率：本期 ${rate(opts.submissionRate.current)}（上期 ${rate(opts.submissionRate.previous)}）
平均正确率：本期 ${rate(opts.correctRate.current)}（上期 ${rate(opts.correctRate.previous)}）
两周掌握度趋势：${opts.trendDelta >= 0 ? "上升" : "下降"} ${pct(Math.abs(opts.trendDelta))}

【薄弱知识点（平均掌握度 < 60%）】
${weakLines}

【高频错因（本期）】
${tagLines}

【待关注学生】
${stuLines}

【分层分布】
${tierLines}

请基于以上数据撰写周报（总结 + 行动建议）。`;
}

/** 7.11 AI 课堂讲评要点（教师讲评页） */
export const LECTURE_SYSTEM = `你是资深初中教研员。基于全班逐题作答统计，为每道题生成课堂讲评要点。
要求：
- 切入角度（angle）：一句话，从本班实际错误出发，指出讲评这道题的切入点。
- 易错点（pitfalls）：2-4 条，结合本题统计（得分率、高频错因、典型错误作答）指出学生最可能出错的地方。
- 变式提问（variant）：1 条课堂追问，检验学生是否真正理解。
- 不虚构统计之外的数据；不点名、不描述具体学生。
${JSON_ONLY}
输出 JSON 结构：
{ "items": [ { "questionId": string, "angle": string, "pitfalls": string[], "variant": string } ] }
其中 items 顺序与输入题目顺序一致，数量相同。`;

export function lectureContext(opts: {
  subjectName: string;
  title: string;
  questions: {
    questionId: string;
    order: number;
    type: string;
    stem: string;
    options: string[];
    answer: string;
    analysis: string | null;
    kpCodes: string[];
    stats: {
      total: number;
      correct: number;
      wrong: number;
      pending: number;
      scoreRate: number | null;
      avgTimeMs: number | null;
      errorTags: { tag: string; count: number }[];
      wrongSamples: { studentNo: string | null; response: string; score: number | null }[];
    };
  }[];
}): string {
  const lines = opts.questions.map((q) => {
    const s = q.stats;
    const tags = s.errorTags.map((t) => `${t.tag} ${t.count} 次`).join("、") || "无";
    const samples =
      s.wrongSamples.length > 0
        ? s.wrongSamples
            .map((w) => `学号 ${w.studentNo ?? "—"} 作答「${w.response}」（${w.score == null ? "待批改" : `${Math.round(w.score * 100)}%`}）`)
            .join("；")
        : "无";
    return `第 ${q.order} 题（${q.type}${q.kpCodes.length ? `，知识点 ${q.kpCodes.join("、")}` : ""}）
题干：${q.stem}
${q.options.length ? `选项：${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("；")}` : ""}
标准答案：${q.answer}${q.analysis ? `\n解析：${q.analysis}` : ""}
全班作答 ${s.total} 人：正确 ${s.correct}、错误 ${s.wrong}、待批改 ${s.pending}；得分率 ${s.scoreRate == null ? "待批改" : `${Math.round(s.scoreRate * 100)}%`}${s.avgTimeMs == null ? "" : `；平均用时 ${Math.round(s.avgTimeMs / 1000)} 秒`}
高频错因：${tags}
典型错误作答：${samples}`;
  });
  return `科目：${opts.subjectName}
作业：${opts.title}
请为以下每道题生成课堂讲评要点：

${lines.join("\n\n")}`;
}
