"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Copy, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EChart } from "@/components/charts/echart";
import { EmptyState } from "@/components/app/empty-state";
import { ConfidenceBadge } from "@/components/app/confidence-badge";
import { hbarOption } from "@/lib/charts";
import { TIER_META, type Tier } from "@/lib/mastery";
import { choiceAnswerText, fmtDate, fmtDateTime, fmtDuration, pct } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface QuestionRow {
  id: string;
  order: number;
  type: string;
  difficulty: number;
  stem: string;
  options: string[];
  kpCodes: string[];
  tier: string | null;
  answer?: string;
  analysis?: string | null;
}
interface AnswerRow {
  id: string;
  questionId: string;
  response: string;
  isCorrect: boolean | null;
  score: number | null;
  timeSpentMs: number | null;
  errorTags: string[];
  errorAnalysis: string | null;
  improvement: string | null;
  confidence: number | null;
  reviewStatus: string;
}
interface SubmissionRow {
  id: string;
  studentId: string;
  studentName: string;
  submittedAt: string;
  avgScore: number | null;
  answers: AnswerRow[];
}
interface DetailData {
  assignment: {
    id: string;
    title: string;
    type: string;
    subjectName: string;
    className: string;
    dueAt: string | null;
    createdAt: string;
  };
  questions: QuestionRow[];
  submissions: SubmissionRow[];
}
interface Analysis {
  summary: string;
  strengths: string[];
  issues: string[];
  suggestions: string[];
}

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

function ScoreIcon({ score }: { score: number | null }) {
  if (score == null) return <Circle className="h-4 w-4 text-muted-foreground" />;
  if (score >= 0.6) return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

/** 得分率（只统计已批改题目） */
function avgScoreOf(answers: AnswerRow[]): number | null {
  const scored = answers.filter((a) => a.score != null);
  if (!scored.length) return null;
  return scored.reduce((acc, a) => acc + (a.score ?? 0), 0) / scored.length;
}

function analysisToText(a: Analysis): string {
  const lines: string[] = ["【本次作业个性化分析】", "", a.summary, ""];
  if (a.strengths.length) {
    lines.push("【表现亮点】");
    a.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (a.issues.length) {
    lines.push("【存在问题】");
    a.issues.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (a.suggestions.length) {
    lines.push("【发展建议】");
    a.suggestions.forEach((s) => lines.push(`- ${s}`));
  }
  return lines.join("\n");
}

export default function AssignmentDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [regrading, setRegrading] = useState<Record<string, boolean>>({});
  // 个性化分析：按学生缓存（切换不丢失）
  const [analyses, setAnalyses] = useState<Record<string, Analysis | null>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

  const loadData = useCallback(() => {
    fetch(`/api/assignments/${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
        if (Array.isArray(j.submissions) && j.submissions.length) setSelectedId(j.submissions[0].id);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selected: SubmissionRow | undefined = useMemo(
    () => data?.submissions.find((s) => s.id === selectedId) ?? data?.submissions[0],
    [data, selectedId]
  );

  // ---------- 选中学生统计（客户端聚合，须在早返回之前调用 hook） ----------
  const selectedAnswers = selected?.answers ?? [];
  const scoreChart = useMemo(() => {
    if (!selectedAnswers.length) return null;
    return hbarOption({
      categories: selectedAnswers.map((_, i) => `第 ${i + 1} 题`),
      name: "得分",
      data: selectedAnswers.map((a) => a.score ?? 0),
      max: 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  const timeChart = useMemo(() => {
    if (!selectedAnswers.length) return null;
    return hbarOption({
      categories: selectedAnswers.map((_, i) => `第 ${i + 1} 题`),
      name: "用时",
      data: selectedAnswers.map((a) => Math.round((a.timeSpentMs ?? 0) / 1000)),
      valueFormatter: (v) => `${Math.round(v)}s`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  const tagCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of selectedAnswers) {
      for (const t of a.errorTags) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  const tagChart = useMemo(() => {
    if (!tagCount.length) return null;
    return hbarOption({
      categories: tagCount.map(([t]) => t),
      name: "错因次数",
      data: tagCount.map(([, c]) => c),
      valueFormatter: (v) => `${v} 次`,
    });
  }, [tagCount]);

  async function regrade(a: AnswerRow) {
    setRegrading((p) => ({ ...p, [a.id]: true }));
    try {
      const r = await fetch("/api/ai/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: a.questionId, response: a.response, answerRecordId: a.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "批改失败");
      // 重批结果已落库（联动掌握度/错题本），重新拉取详情展示最新状态
      loadData();
      if (j.persisted === false) {
        toast.warning("AI 未能完成批改（未配置 Key 或调用失败），保持待复核状态");
      } else {
        toast.success("AI 重批完成，结果已保存");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "批改失败");
    } finally {
      setRegrading((p) => ({ ...p, [a.id]: false }));
    }
  }

  async function analyze(s: SubmissionRow) {
    setAnalyzing((p) => ({ ...p, [s.id]: true }));
    try {
      const r = await fetch("/api/ai/submission-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: s.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "分析失败");
      setAnalyses((p) => ({ ...p, [s.id]: j.analysis as Analysis }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "分析失败");
    } finally {
      setAnalyzing((p) => ({ ...p, [s.id]: false }));
    }
  }

  async function copyAnalysis(s: SubmissionRow) {
    const a = analyses[s.id];
    if (!a) return;
    try {
      await navigator.clipboard.writeText(analysisToText(a));
      toast.success("分析已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  }

  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96" />;

  const qById = new Map(data.questions.map((q) => [q.id, q]));

  const wrongCount = selectedAnswers.filter(
    (a) => a.isCorrect === false || (a.score != null && a.score < 0.6)
  ).length;
  const totalTime = selectedAnswers.reduce((acc, a) => acc + (a.timeSpentMs ?? 0), 0);
  const scoreRate = avgScoreOf(selectedAnswers);
  const analysis = selected ? (analyses[selected.id] ?? null) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher/assignments">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">{data.assignment.title}</h1>
        <Badge variant={data.assignment.type === "QUIZ" ? "secondary" : "outline"}>
          {data.assignment.type === "QUIZ" ? "测验" : "作业"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {data.assignment.subjectName} · {data.assignment.className} · 截止{" "}
          {fmtDate(data.assignment.dueAt)} · 已交 {data.submissions.length} 份
        </span>
      </div>

      {/* 学生作答与批改（分区展示） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">学生作答与批改</CardTitle>
          <CardDescription>点击学生切换作答视图；右侧为该生本次作业统计与 AI 个性化分析。</CardDescription>
          {/* 学生切换条 */}
          <div className="flex gap-2 overflow-x-auto pb-1 pt-2">
            {data.submissions.map((s) => {
              const rate = avgScoreOf(s.answers);
              const active = s.id === (selected?.id ?? "");
              return (
                <Button
                  key={s.id}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className={cn("shrink-0 gap-1.5", !active && "bg-background")}
                  onClick={() => setSelectedId(s.id)}
                >
                  {s.studentName}
                  <Badge
                    variant={active ? "secondary" : "outline"}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {rate == null ? "待批改" : pct(rate)}
                  </Badge>
                </Button>
              );
            })}
            {!data.submissions.length ? (
              <EmptyState title="暂无学生提交" hint="学生提交后，此处可按学生切换查看作答与个性化分析。" />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {selected ? (
            <div className="grid gap-4 lg:grid-cols-5">
              {/* 左侧：该生逐题作答 */}
              <div className="space-y-2 lg:col-span-3">
                {selected.answers.map((a, i) => {
                  const q = qById.get(a.questionId);
                  const score = a.score;
                  return (
                    <div key={a.questionId} className="rounded-md bg-muted/50 p-2.5 text-sm">
                      <div className="flex items-start gap-2">
                        <ScoreIcon score={score} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              第 {i + 1} 题 · {TYPE_LABEL[q?.type ?? ""] ?? "—"}
                            </span>
                            {q?.tier ? (
                              <Badge className="bg-amber-100 text-amber-800">
                                仅{TIER_META[q.tier as Tier].short}层
                              </Badge>
                            ) : null}
                            {q?.kpCodes.map((c) => (
                              <Badge key={c} variant="secondary">
                                {c}
                              </Badge>
                            ))}
                            {q?.type === "OPEN_RESPONSE" && a.confidence != null ? (
                              <ConfidenceBadge confidence={a.confidence} />
                            ) : null}
                            {a.reviewStatus === "needs_review" ? (
                              <Badge className="bg-amber-100 text-amber-800">
                                待复核
                                <Link
                                  href="/teacher/review"
                                  className="ml-1 underline underline-offset-2"
                                >
                                  去复核
                                </Link>
                              </Badge>
                            ) : a.reviewStatus === "reviewed" ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                已复核
                              </Badge>
                            ) : null}
                          </div>
                          <div className="truncate text-muted-foreground">{q?.stem}</div>
                          <div className="mt-1">
                            <span className="font-medium">作答：</span>
                            <span className={a.isCorrect === false ? "text-red-600" : ""}>
                              {a.response || "（空）"}
                            </span>
                            {score != null ? (
                              <Badge variant="outline" className="ml-2">
                                {pct(score)}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="ml-2 text-muted-foreground">
                                待批改
                              </Badge>
                            )}
                            {a.timeSpentMs ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                用时 {Math.round(a.timeSpentMs / 1000)}s
                              </span>
                            ) : null}
                          </div>
                          {a.errorTags?.length ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {a.errorTags.map((t) => (
                                <Badge key={t} variant="destructive" className="text-[10px]">
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          {a.errorAnalysis ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              归因：{a.errorAnalysis}
                            </div>
                          ) : null}
                          {a.improvement ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              建议：{a.improvement}
                            </div>
                          ) : null}
                        </div>
                        {q?.type === "OPEN_RESPONSE" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 gap-1"
                            disabled={regrading[a.id]}
                            onClick={() => regrade(a)}
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${regrading[a.id] ? "animate-spin" : ""}`}
                            />
                            AI 重批
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 右侧：统计 + AI 个性化分析 */}
              <div className="space-y-4 lg:col-span-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">本次作答统计 · {selected.studentName}</CardTitle>
                    <CardDescription>{fmtDateTime(selected.submittedAt)} 提交</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-1.5 text-center sm:gap-2">
                      <div className="rounded-lg border p-1.5 sm:p-2">
                        <div className="text-base font-semibold tabular-nums sm:text-lg">
                          {scoreRate == null ? "—" : pct(scoreRate)}
                        </div>
                        <div className="text-xs text-muted-foreground">得分率</div>
                      </div>
                      <div className="rounded-lg border p-1.5 sm:p-2">
                        <div className="text-base font-semibold tabular-nums sm:text-lg">
                          {fmtDuration(totalTime)}
                        </div>
                        <div className="text-xs text-muted-foreground">总用时</div>
                      </div>
                      <div className="rounded-lg border p-1.5 sm:p-2">
                        <div className="text-base font-semibold tabular-nums sm:text-lg">{wrongCount}</div>
                        <div className="text-xs text-muted-foreground">错题数</div>
                      </div>
                    </div>
                    {scoreChart ? (
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">每题得分</div>
                        <EChart option={scoreChart} height={Math.max(120, selectedAnswers.length * 30 + 30)} />
                      </div>
                    ) : null}
                    {timeChart ? (
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">每题用时</div>
                        <EChart option={timeChart} height={Math.max(120, selectedAnswers.length * 30 + 30)} />
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground">错因分布</div>
                      {tagChart ? (
                        <EChart option={tagChart} height={Math.max(100, tagCount.length * 34 + 30)} />
                      ) : (
                        <p className="py-3 text-center text-xs text-muted-foreground">本次无错误标签</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Sparkles className="h-4 w-4" />
                      AI 个性化分析
                    </CardTitle>
                    <CardDescription>
                      基于该生本次作答生成分析与发展建议；可编辑、可复制，仅供教师参考。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {analysis ? (
                      <>
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground">总评</div>
                          <Input
                            value={analysis.summary}
                            onChange={(e) =>
                              setAnalyses((p) => ({
                                ...p,
                                [selected.id]: { ...analysis, summary: e.target.value },
                              }))
                            }
                          />
                        </div>
                        {(
                          [
                            ["strengths", "表现亮点"],
                            ["issues", "存在问题"],
                            ["suggestions", "发展建议"],
                          ] as const
                        ).map(([key, label]) => (
                          <div key={key} className="space-y-1.5">
                            <div className="text-xs font-medium text-muted-foreground">
                              {label}（每行一条）
                            </div>
                            <textarea
                              className="h-24 w-full rounded-md border border-input bg-background p-2 text-sm"
                              value={analysis[key].join("\n")}
                              onChange={(e) =>
                                setAnalyses((p) => ({
                                  ...p,
                                  [selected.id]: { ...analysis, [key]: e.target.value.split("\n") },
                                }))
                              }
                            />
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={() => copyAnalysis(selected)} className="gap-1.5">
                          <Copy className="h-4 w-4" />
                          复制分析
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={analyzing[selected.id]}
                        onClick={() => analyze(selected)}
                      >
                        {analyzing[selected.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        {analyzing[selected.id] ? "分析中…" : "生成个性化分析"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 题目与标准答案（次要信息，置于底部） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">题目与标准答案</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.questions.map((q) => (
            <div key={q.id} className="rounded-lg border p-3 text-sm">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {q.order}. {TYPE_LABEL[q.type] ?? q.type}
                </span>
                <Badge variant="outline">难度 {q.difficulty}</Badge>
                {q.tier ? (
                  <Badge className="bg-amber-100 text-amber-800">
                    仅{TIER_META[q.tier as Tier].short}层
                  </Badge>
                ) : (
                  <Badge variant="outline">全体</Badge>
                )}
                {q.kpCodes.map((c) => (
                  <Badge key={c} variant="secondary">
                    {c}
                  </Badge>
                ))}
              </div>
              <div>{q.stem}</div>
              {q.options?.length ? (
                <div className="mt-1 text-muted-foreground">
                  {q.options.map((o, i) => (
                    <span key={i} className="mr-3">
                      {String.fromCharCode(65 + i)}. {o}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">答案：</span>
                {q.type === "SINGLE_CHOICE" && q.options?.length
                  ? choiceAnswerText(q.options, q.answer ?? "")
                  : q.answer}
                {q.analysis ? (
                  <>
                    <span className="ml-3 font-medium text-foreground">解析：</span>
                    {q.analysis}
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
