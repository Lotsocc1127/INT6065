"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtDateTime, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface QuestionRow {
  id: string;
  order: number;
  type: string;
  difficulty: number;
  stem: string;
  options: string[];
  kpCodes: string[];
  answer?: string;
  analysis?: string | null;
}
interface AnswerRow {
  questionId: string;
  response: string;
  isCorrect: boolean | null;
  score: number | null;
  timeSpentMs: number | null;
  errorTags: string[];
  errorAnalysis: string | null;
  improvement: string | null;
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

export default function AssignmentDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [regrading, setRegrading] = useState<Record<string, boolean>>({});
  const [regrades, setRegrades] = useState<Record<string, unknown>>({});

  useEffect(() => {
    fetch(`/api/assignments/${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function regrade(questionId: string, response: string) {
    setRegrading((p) => ({ ...p, [questionId]: true }));
    try {
      const r = await fetch("/api/ai/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, response }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "批改失败");
      setRegrades((p) => ({ ...p, [questionId]: j }));
      toast.success("AI 重批完成");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "批改失败");
    } finally {
      setRegrading((p) => ({ ...p, [questionId]: false }));
    }
  }

  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96" />;

  const qById = new Map(data.questions.map((q) => [q.id, q]));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
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

      {/* 题目与答案 */}
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
                {q.answer}
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

      {/* 学生作答 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">学生作答与批改（{data.submissions.length}）</CardTitle>
          <CardDescription>客观题自动判分；解答题由 AI 批改（可在单题上点击「AI 重批」复核）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.submissions.length ? (
            <p className="text-sm text-muted-foreground">暂无学生提交。</p>
          ) : null}
          {data.submissions.map((s) => (
            <div key={s.id} className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <Link
                  href={`/teacher/students/${s.studentId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {s.studentName}
                </Link>
                <span className="text-xs text-muted-foreground">{fmtDateTime(s.submittedAt)}</span>
                {s.avgScore != null ? (
                  <Badge variant={s.avgScore >= 0.8 ? "default" : s.avgScore >= 0.6 ? "secondary" : "destructive"}>
                    均分 {pct(s.avgScore)}
                  </Badge>
                ) : (
                  <Badge variant="outline">待批改</Badge>
                )}
              </div>
              <div className="space-y-2">
                {s.answers.map((a) => {
                  const q = qById.get(a.questionId);
                  const rg = regrades[a.questionId] as
                    | { isCorrect?: boolean; score?: number; errorAnalysis?: string }
                    | undefined;
                  const score = rg?.score ?? a.score;
                  return (
                    <div key={a.questionId} className="rounded-md bg-muted/50 p-2.5 text-sm">
                      <div className="flex items-start gap-2">
                        <ScoreIcon score={score} />
                        <div className="min-w-0 flex-1">
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
                            ) : null}
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
                          {(rg?.errorAnalysis ?? a.errorAnalysis) ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              归因：{rg?.errorAnalysis ?? a.errorAnalysis}
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
                            disabled={regrading[a.questionId]}
                            onClick={() => regrade(a.questionId, a.response)}
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${regrading[a.questionId] ? "animate-spin" : ""}`}
                            />
                            AI 重批
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
