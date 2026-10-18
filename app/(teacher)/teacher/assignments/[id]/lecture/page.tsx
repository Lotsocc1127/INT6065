"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MonitorPlay, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EChart } from "@/components/charts/echart";
import { EmptyState } from "@/components/app/empty-state";
import { hbarOption } from "@/lib/charts";
import { TIER_META, type Tier } from "@/lib/mastery";
import { choiceAnswerText, fmtDuration, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

interface LectureItem {
  questionId: string;
  angle: string;
  pitfalls: string[];
  variant: string;
}

interface QuestionStats {
  total: number;
  correct: number;
  wrong: number;
  pending: number;
  scoreRate: number | null;
  avgTimeMs: number | null;
  errorTags: { tag: string; count: number }[];
  tierBreakdown: { tier: Tier; total: number; wrong: number }[];
  optionDist: { option: string; count: number }[] | null;
  wrongSamples: { studentNo: string | null; response: string; score: number | null }[];
}

interface QuestionRow {
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
  stats: QuestionStats;
}

interface LectureData {
  assignment: {
    id: string;
    title: string;
    type: string;
    subjectName: string;
    className: string;
    dueAt: string | null;
  };
  questions: QuestionRow[];
}

export default function LecturePage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [data, setData] = useState<LectureData | null>(null);
  const [error, setError] = useState("");
  // AI 讲评要点：按题目缓存（仅内存，不落库）
  const [items, setItems] = useState<Record<string, LectureItem>>({});
  const [generating, setGenerating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`/api/assignments/${id}/lecture`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const generate = useCallback(
    async (questionId?: string) => {
      const key = questionId ?? "__all__";
      setGenerating((g) => ({ ...g, [key]: true }));
      try {
        const r = await fetch("/api/ai/lecture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId: id, ...(questionId ? { questionId } : {}) }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "生成失败");
        setItems((prev) => {
          const next = { ...prev };
          for (const it of j.items as LectureItem[]) next[it.questionId] = it;
          return next;
        });
        if (!j.aiGenerated) toast.info("未配置 LLM，已使用模板讲评要点");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "生成失败");
      } finally {
        setGenerating((g) => ({ ...g, [key]: false }));
      }
    },
    [id]
  );

  if (error) return <p className="p-6 text-destructive">{error}</p>;
  if (!data)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );

  const allGenerating = generating["__all__"];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* 头部：投影时也保持可读 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/assignments/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            返回批改
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">
          <MonitorPlay className="mr-1.5 inline h-5 w-5 align-[-3px]" />
          {data.assignment.title} · 课堂讲评
        </h1>
        <Badge variant={data.assignment.type === "QUIZ" ? "secondary" : "outline"}>
          {data.assignment.type === "QUIZ" ? "测验" : "作业"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {data.assignment.subjectName} · {data.assignment.className}
        </span>
        <Button
          size="sm"
          className="ml-auto gap-1.5"
          disabled={allGenerating}
          onClick={() => generate()}
        >
          {allGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          生成全部讲评要点
        </Button>
      </div>

      {!data.questions.length ? (
        <EmptyState title="暂无题目" hint="该作业没有题目数据。" />
      ) : null}

      {/* 逐题讲评卡片（服务端已按错误率降序排序） */}
      {data.questions.map((q, qi) => {
        const s = q.stats;
        const item = items[q.id];
        const generatingOne = generating[q.id];
        const tierChips = s.tierBreakdown.map((b) => (
          <span
            key={b.tier}
            className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
          >
            {TIER_META[b.tier].short} {b.wrong}/{b.total} 错
          </span>
        ));
        return (
          <Card key={q.id}>
            <CardHeader>
              <CardTitle className="text-base">
                讲评 {qi + 1} · 第 {q.order} 题
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {TYPE_LABEL[q.type]} · 难度 {q.difficulty}/5
                </span>
              </CardTitle>
              <CardDescription className="flex flex-wrap gap-1.5">
                {q.kpCodes.map((c) => (
                  <Badge key={c} variant="secondary" className="text-xs">
                    {c}
                  </Badge>
                ))}
                {q.tier ? (
                  <Badge variant="outline" className="text-xs">
                    仅{TIER_META[q.tier as Tier].short}层
                  </Badge>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 题干与标准答案（投影字号加大） */}
              <div className="space-y-2 text-lg leading-relaxed">
                <p>{q.stem}</p>
                {q.options.length ? (
                  <div className="space-y-1">
                    {q.options.map((o, i) => (
                      <p key={i} className="text-base text-muted-foreground">
                        {String.fromCharCode(65 + i)}. {o}
                      </p>
                    ))}
                  </div>
                ) : null}
                <p className="text-base">
                  <span className="font-medium">标准答案：</span>
                  {q.type === "SINGLE_CHOICE" ? choiceAnswerText(q.options, q.answer) : q.answer}
                </p>
                {q.analysis ? (
                  <p className="text-sm text-muted-foreground">解析：{q.analysis}</p>
                ) : null}
              </div>

              {/* 统计行 */}
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border bg-muted/40 p-4">
                <div>
                  <div className="text-xs text-muted-foreground">得分率</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {s.scoreRate == null ? "待批改" : pct(s.scoreRate)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">作答</div>
                  <div className="text-2xl font-semibold tabular-nums">{s.total} 人</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">正确 / 错误 / 待批改</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    <span className="text-emerald-600">{s.correct}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-red-500">{s.wrong}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-amber-600">{s.pending}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">平均用时</div>
                  <div className="text-2xl font-semibold tabular-nums">{fmtDuration(s.avgTimeMs)}</div>
                </div>
                {s.tierBreakdown.some((b) => b.total > 0) ? (
                  <div className="flex flex-wrap gap-1.5">{tierChips}</div>
                ) : null}
              </div>

              {/* 选项分布 + 错因（两栏） */}
              {s.optionDist ? (
                <div>
                  <h3 className="mb-1 text-sm font-medium">选项分布（{s.optionDist.reduce((a, o) => a + o.count, 0)} 人作答）</h3>
                  <EChart
                    option={hbarOption({
                      categories: s.optionDist.map((o) => o.option),
                      name: "选项人数",
                      data: s.optionDist.map((o) => o.count),
                      valueFormatter: (v) => `${v} 人`,
                    })}
                    height={Math.max(120, s.optionDist.length * 34 + 40)}
                  />
                </div>
              ) : null}
              {s.errorTags.length ? (
                <div>
                  <h3 className="mb-1 text-sm font-medium">高频错因</h3>
                  <EChart
                    option={hbarOption({
                      categories: s.errorTags.map((t) => t.tag),
                      name: "错因次数",
                      data: s.errorTags.map((t) => t.count),
                      valueFormatter: (v) => `${v} 次`,
                    })}
                    height={Math.max(120, s.errorTags.length * 34 + 40)}
                  />
                </div>
              ) : null}

              {/* 典型错误作答（脱敏：仅学号） */}
              {s.wrongSamples.length ? (
                <div>
                  <h3 className="mb-1 text-sm font-medium">典型错误作答（{s.wrongSamples.length >= 5 ? "前 5 条" : `${s.wrongSamples.length} 条`}）</h3>
                  <div className="space-y-1 rounded-lg border bg-muted/40 p-3">
                    {s.wrongSamples.map((w, i) => (
                      <p key={i} className="text-sm text-muted-foreground">
                        学号 {w.studentNo ?? "—"} · 作答「{w.response}」 ·{" "}
                        {w.score == null ? "待批改" : `${Math.round(w.score * 100)}%`}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* AI 讲评要点 */}
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">讲评要点</h3>
                  {!item ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={generatingOne}
                      onClick={() => generate(q.id)}
                    >
                      {generatingOne ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      生成讲评要点
                    </Button>
                  ) : null}
                </div>
                {item ? (
                  <div className="mt-2 space-y-2 text-sm">
                    <p>
                      <span className="font-medium">切入角度：</span>
                      {item.angle}
                    </p>
                    {item.pitfalls.length ? (
                      <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                        {item.pitfalls.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    ) : null}
                    <p>
                      <span className="font-medium">变式提问：</span>
                      {item.variant}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    基于本题全班统计生成切入角度、易错点与变式提问。
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
