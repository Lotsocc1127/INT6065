"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, fmtDuration, pct } from "@/lib/utils";
import { TIER_META, type Tier } from "@/lib/mastery";

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
interface DetailData {
  assignment: {
    id: string;
    title: string;
    type: string;
    subjectCode: string;
    subjectName: string;
    className: string;
    dueAt: string | null;
  };
  questions: QuestionRow[];
  myTier: string | null;
  mySubmission: {
    id: string;
    submittedAt: string;
    answers: AnswerRow[];
  } | null;
}
interface SubmitResult {
  results: AnswerRow[];
  mastery: Record<string, number>;
}

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

export default function StudentAssignmentPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [kpNames, setKpNames] = useState<Record<string, string>>({});
  const initialized = useRef(false);

  useEffect(() => {
    fetch(`/api/assignments/${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
        if (!j.mySubmission) {
          const now = Date.now();
          setStartedAt(Object.fromEntries(j.questions.map((q: QuestionRow) => [q.id, now])));
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  // 知识点名称（提交后展示掌握度变化用）
  useEffect(() => {
    if (!data || !result) return;
    if (initialized.current) return;
    initialized.current = true;
    fetch(`/api/subjects/${data.assignment.subjectCode}/knowledge-points`)
      .then((r) => r.json())
      .then((kps) => {
        if (!Array.isArray(kps)) return;
        const map: Record<string, string> = {};
        for (const k of kps) map[k.id] = `${k.code} ${k.name}`;
        setKpNames(map);
      })
      .catch(() => {});
  }, [data, result]);

  async function submit() {
    if (!data) return;
    const payload = {
      answers: data.questions.map((q) => ({
        questionId: q.id,
        response: answers[q.id] ?? "",
        timeSpentMs: Date.now() - (startedAt[q.id] ?? Date.now()),
      })),
    };
    setSubmitting(true);
    try {
      const r = await fetch(`/api/assignments/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "提交失败");
      setResult(j);
      toast.success("提交成功！批改完成，看板与图谱已实时更新");
      // 重新拉取详情（题目答案/解析可见）
      const d2 = await fetch(`/api/assignments/${id}`).then((r) => r.json());
      setData(d2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96" />;

  const submission = data.mySubmission;
  const answerByQ = new Map((submission?.answers ?? []).map((a) => [a.questionId, a]));
  const overall = submission?.answers.length
    ? submission.answers.reduce((a, b) => a + (b.score ?? 0), 0) / submission.answers.length
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/student">
            <ArrowLeft className="h-4 w-4" />
            返回任务中心
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">{data.assignment.title}</h1>
        <Badge variant={data.assignment.type === "QUIZ" ? "secondary" : "outline"}>
          {data.assignment.type === "QUIZ" ? "测验" : "作业"}
        </Badge>
        {data.myTier ? (
          <Badge className="bg-[#1c5cab]">
            我的层级：{TIER_META[data.myTier as Tier].label}
          </Badge>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {data.assignment.subjectName} · {fmtDate(data.assignment.dueAt)} 截止
        </span>
        {overall != null ? (
          <Badge variant={overall >= 0.8 ? "default" : overall >= 0.6 ? "secondary" : "destructive"}>
            总分 {pct(overall)}
          </Badge>
        ) : null}
      </div>

      {/* 提交后的掌握度更新提示 */}
      {result ? (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardHeader>
            <CardTitle className="text-base text-emerald-800">掌握度已更新</CardTitle>
            <CardDescription>本次作答已计入以下知识点的掌握度（旧:新 = 6:4 加权）</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {Object.entries(result.mastery).map(([kpId, v]) => (
              <div key={kpId} className="min-w-36 flex-1 rounded-lg border border-emerald-200 bg-white p-3">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">{kpNames[kpId] ?? "知识点"}</span>
                  <span className="tabular-nums">{pct(v)}</span>
                </div>
                <Progress value={v * 100} className="bg-emerald-100" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {submission ? (
        /* ---- 批改结果视图 ---- */
        <Card>
          <CardHeader>
            <CardTitle className="text-base">批改结果</CardTitle>
            <CardDescription>
              提交于 {fmtDate(submission.submittedAt)} · 客观题自动判分，解答题由 AI 按步骤给分
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.questions.map((q) => {
              const a = answerByQ.get(q.id);
              return (
                <div key={q.id} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {q.order}. {TYPE_LABEL[q.type] ?? q.type}
                    </span>
                    {q.kpCodes.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                    {a?.isCorrect === true ? (
                      <Badge className="gap-1 bg-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> 正确
                      </Badge>
                    ) : a?.isCorrect === false ? (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" /> 错误
                      </Badge>
                    ) : (
                      <Badge variant="outline">{a?.score != null ? `部分得分 ${pct(a.score)}` : "待批改"}</Badge>
                    )}
                    {a?.timeSpentMs ? (
                      <span className="ml-auto text-xs text-muted-foreground">
                        用时 {fmtDuration(a.timeSpentMs)}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground">{q.stem}</div>
                  <div className="mt-1.5">
                    <span className="font-medium">我的作答：</span>
                    <span className={a?.isCorrect === false ? "text-red-600" : ""}>{a?.response || "（空）"}</span>
                  </div>
                  {q.answer ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">标准答案：</span>
                      {q.answer}
                    </div>
                  ) : null}
                  {a?.errorTags?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.errorTags.map((t) => (
                        <Badge key={t} variant="destructive" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {a?.errorAnalysis ? (
                    <div className="mt-1 rounded bg-muted p-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">错因分析：</span>
                      {a.errorAnalysis}
                    </div>
                  ) : null}
                  {a?.improvement ? (
                    <div className="mt-1 rounded bg-muted p-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">下一步建议：</span>
                      {a.improvement}
                    </div>
                  ) : null}
                  {q.analysis ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">解析：</span>
                      {q.analysis}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        /* ---- 作答视图 ---- */
        <Card>
          <CardHeader>
            <CardTitle className="text-base">作答（共 {data.questions.length} 题）</CardTitle>
            <CardDescription>解答题将由 AI 批改老师按步骤给分，请尽量写出过程。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.questions.map((q) => (
              <div key={q.id} className="space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
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
                <div className="text-sm">{q.stem}</div>
                {q.type === "SINGLE_CHOICE" ? (
                  <div className="space-y-2">
                    {q.options.map((o, i) => {
                      const letter = String.fromCharCode(65 + i);
                      return (
                        <Label
                          key={i}
                          className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition-colors ${
                            answers[q.id] === letter ? "border-primary bg-accent" : "hover:bg-accent/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`q-${q.id}`}
                            value={letter}
                            checked={answers[q.id] === letter}
                            onChange={(e) =>
                              setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            className="h-4 w-4 accent-foreground"
                          />
                          <span>
                            {letter}. {o}
                          </span>
                        </Label>
                      );
                    })}
                  </div>
                ) : q.type === "FILL_BLANK" ? (
                  <Input
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="填写答案"
                    className="max-w-xs"
                  />
                ) : (
                  <Textarea
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="写出解题步骤与答案…"
                    rows={4}
                  />
                )}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                已作答 {Object.values(answers).filter((v) => v.trim()).length} / {data.questions.length} 题
              </span>
              <Button onClick={submit} disabled={submitting} className="gap-2">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    批改中…
                  </>
                ) : (
                  "提交作业"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
