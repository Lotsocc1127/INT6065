"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Lightbulb, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface WrongRow {
  id: string;
  questionId: string;
  stem: string;
  type: string;
  options: string[];
  answer: string;
  analysis: string | null;
  difficulty: number;
  kpCodes: string[];
  kpNames: string[];
  wrongCount: number;
  mastered: boolean;
  lastWrongAt: string;
  lastResponse: string | null;
  errorTags: string[];
  errorAnalysis: string | null;
}
interface SimilarQuestion {
  stem: string;
  answer: string;
  analysis: string;
}

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

function WrongBook() {
  const searchParams = useSearchParams();
  const subject = searchParams.get("subject") ?? "math";
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [list, setList] = useState<WrongRow[] | null>(null);
  const [error, setError] = useState("");
  const [similarFor, setSimilarFor] = useState<WrongRow | null>(null);
  const [similars, setSimilars] = useState<SimilarQuestion[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [revealIdx, setRevealIdx] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => setSubjects(Array.isArray(s) ? s : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setList(null);
    setError("");
    fetch(`/api/wrong-questions?subject=${subject}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setList(Array.isArray(j) ? j : []);
      })
      .catch((e) => setError(e.message));
  }, [subject]);

  async function markMastered(w: WrongRow) {
    try {
      const r = await fetch(`/api/wrong-questions/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mastered: !w.mastered }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      setList((prev) =>
        (prev ?? []).map((x) => (x.id === w.id ? { ...x, mastered: j.mastered } : x))
      );
      toast.success(j.mastered ? "已标记为掌握 🎉" : "已移回错题本");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function generateSimilar(w: WrongRow) {
    setSimilarFor(w);
    setSimilars(null);
    setSimilarLoading(true);
    setRevealIdx(new Set());
    try {
      const r = await fetch("/api/ai/similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: w.questionId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      setSimilars(j.questions ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setSimilarLoading(false);
    }
  }

  if (error) return <p className="text-destructive">{error}</p>;

  const active = (list ?? []).filter((w) => !w.mastered);
  const mastered = (list ?? []).filter((w) => w.mastered);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SubjectSwitcher subjects={subjects} current={subject} />
        {list ? (
          <span className="text-sm text-muted-foreground">
            待攻克 {active.length} · 已攻克 {mastered.length}
          </span>
        ) : null}
      </div>
      {!list && !error ? <Skeleton className="h-96" /> : null}
      {list ? (
        <>
          {!list.length ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                暂无错题记录，保持住！🎉
              </CardContent>
            </Card>
          ) : null}
          <div className="space-y-3">
            {active.map((w) => (
              <Card key={w.id} className={w.mastered ? "opacity-70" : ""}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{TYPE_LABEL[w.type] ?? w.type}</Badge>
                      <Badge variant="outline">难度 {w.difficulty}</Badge>
                      {w.kpNames.map((n, i) => (
                        <Badge key={i} variant="secondary">
                          {n}
                        </Badge>
                      ))}
                      {w.wrongCount > 1 ? (
                        <Badge variant="destructive">错 {w.wrongCount} 次</Badge>
                      ) : null}
                    </div>
                    <CardTitle className="text-sm font-normal leading-relaxed">{w.stem}</CardTitle>
                    {w.lastResponse ? (
                      <CardDescription>
                        我的作答：<span className="text-red-500">{w.lastResponse}</span>
                        <span className="ml-2">正解：{w.answer}</span>
                      </CardDescription>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => generateSimilar(w)}>
                      <Sparkles className="h-3.5 w-3.5" />
                      举一反三
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => markMastered(w)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      标记掌握
                    </Button>
                  </div>
                </CardHeader>
                {w.errorTags?.length || w.errorAnalysis ? (
                  <CardContent className="space-y-1.5 pt-0">
                    {w.errorTags?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {w.errorTags.map((t) => (
                          <Badge key={t} variant="destructive" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {w.errorAnalysis ? (
                      <p className="text-xs text-muted-foreground">
                        <Lightbulb className="mr-1 inline h-3 w-3" />
                        {w.errorAnalysis}
                      </p>
                    ) : null}
                  </CardContent>
                ) : null}
              </Card>
            ))}
            {mastered.length ? (
              <div className="pt-2">
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">已攻克（{mastered.length}）</h2>
                <div className="space-y-2">
                  {mastered.map((w) => (
                    <Card key={w.id} className="opacity-70">
                      <CardHeader className="flex-row items-center justify-between space-y-0">
                        <div className="space-y-1">
                          <CardTitle className="text-sm font-normal line-through">{w.stem}</CardTitle>
                          <CardDescription>
                            攻克于 {fmtDate(w.lastWrongAt)} · 错 {w.wrongCount} 次后掌握
                          </CardDescription>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => markMastered(w)}>
                          移回错题本
                        </Button>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* 举一反三对话框 */}
      <Dialog open={Boolean(similarFor)} onOpenChange={(o) => !o && setSimilarFor(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              举一反三练习
            </DialogTitle>
            <DialogDescription>
              针对你的错题生成 3 道同知识点、同方法、难度递进的练习题。先自己做，再点开答案核对。
            </DialogDescription>
          </DialogHeader>
          {similarLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {(similars ?? []).map((s, i) => (
                <div key={i} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 font-medium">
                    {i + 1}. {s.stem}
                  </div>
                  {revealIdx.has(i) ? (
                    <div className="mt-1 space-y-0.5 rounded bg-muted p-2 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">答案：</span>
                        {s.answer}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">解析：</span>
                        {s.analysis}
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7 px-2 text-xs"
                      onClick={() => setRevealIdx((prev) => new Set(prev).add(i))}
                    >
                      查看答案
                    </Button>
                  )}
                </div>
              ))}
              {similars && !similars.length ? (
                <p className="text-center text-sm text-muted-foreground">生成失败，请重试</p>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WrongBookPage() {
  return (
    <Suspense>
      <WrongBook />
    </Suspense>
  );
}
