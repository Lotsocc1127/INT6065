"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, ClipboardCheck, ExternalLink, Loader2, MessageSquareWarning, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { ConfidenceBadge } from "@/components/app/confidence-badge";
import { fmtDateTime, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface QueueItem {
  id: string;
  studentName: string;
  className: string;
  assignmentId: string;
  assignmentTitle: string;
  submittedAt: string;
  stem: string;
  type: string;
  options: string[];
  answer: string;
  analysis: string | null;
  response: string;
  isCorrect: boolean | null;
  score: number | null;
  confidence: number | null;
  errorTags: string[];
  errorAnalysis: string | null;
  improvement: string | null;
}

/** 学习目标申诉（第二个队列，与作业复核分开） */
interface AppealItem {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  content: string;
  kpId: string | null;
  done: boolean;
  appealReason: string | null;
  appealRequestedAt: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

export default function ReviewPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<Record<string, boolean>>({});
  // 改判表单：recordId -> { isCorrect, scorePct, errorAnalysis, open }
  const [forms, setForms] = useState<Record<string, { isCorrect: boolean; scorePct: number; errorAnalysis: string; open: boolean }>>({});

  // 目标申诉队列：状态与作业队列完全独立，避免任一队列出错/加载中时把另一块也清空
  const [appeals, setAppeals] = useState<AppealItem[] | null>(null);
  const [appealError, setAppealError] = useState("");
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classFilter, setClassFilter] = useState("all");
  const [appealActing, setAppealActing] = useState<Record<string, boolean>>({});
  const [appealReplies, setAppealReplies] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetch("/api/review-queue")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setItems(j.items);
      })
      .catch((e) => setError(e.message));
  }, []);

  const loadAppeals = useCallback((cid: string) => {
    setAppeals(null);
    setAppealError("");
    const qs = cid && cid !== "all" ? `?classId=${cid}` : "";
    fetch(`/api/teacher/appeals${qs}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setAppeals(j.items);
      })
      .catch((e) => setAppealError(e.message));
  }, []);

  useEffect(() => {
    load();
    loadAppeals("all");
    fetch("/api/classes")
      .then((r) => r.json())
      .then((c) => setClasses(Array.isArray(c) ? c : []))
      .catch(() => {});
  }, [load, loadAppeals]);

  function toggleForm(rec: QueueItem) {
    setForms((p) => ({
      ...p,
      [rec.id]: {
        open: !p[rec.id]?.open,
        isCorrect: p[rec.id]?.isCorrect ?? rec.isCorrect ?? true,
        scorePct: p[rec.id]?.scorePct ?? Math.round((rec.score ?? 0.6) * 100),
        errorAnalysis: p[rec.id]?.errorAnalysis ?? rec.errorAnalysis ?? "",
      },
    }));
  }

  async function confirm(rec: QueueItem) {
    setActing((p) => ({ ...p, [rec.id]: true }));
    try {
      const r = await fetch("/api/review-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: rec.id, action: "confirm" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      toast.success(`已确认 AI 判分（${rec.studentName}）`);
      setItems((list) => list?.filter((x) => x.id !== rec.id) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setActing((p) => ({ ...p, [rec.id]: false }));
    }
  }

  async function saveOverride(rec: QueueItem) {
    const f = forms[rec.id];
    if (!f) return;
    setActing((p) => ({ ...p, [rec.id]: true }));
    try {
      const r = await fetch("/api/review-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: rec.id,
          action: "override",
          isCorrect: f.isCorrect,
          score: f.scorePct / 100,
          errorAnalysis: f.errorAnalysis,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      const kps = Object.entries((j.mastery ?? {}) as Record<string, number>);
      toast.success(
        kps.length
          ? `复核已保存，${kps.length} 个知识点掌握度已联动更新`
          : `复核已保存（${rec.studentName}）`
      );
      setItems((list) => list?.filter((x) => x.id !== rec.id) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setActing((p) => ({ ...p, [rec.id]: false }));
    }
  }

  async function resolveAppeal(item: AppealItem, decision: "accept" | "reject") {
    setAppealActing((p) => ({ ...p, [item.id]: true }));
    try {
      const r = await fetch(`/api/teacher/appeals/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reply: appealReplies[item.id] ?? "" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      toast.success(
        decision === "accept"
          ? `已采纳申诉，目标已视为达成（${item.studentName}）`
          : `已驳回申诉（${item.studentName}）`
      );
      setAppeals((list) => list?.filter((x) => x.id !== item.id) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setAppealActing((p) => ({ ...p, [item.id]: false }));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5" />
        <h1 className="text-xl font-semibold">待复核</h1>
        <Badge variant="secondary">{(items?.length ?? 0) + (appeals?.length ?? 0)}</Badge>
        <p className="text-sm text-muted-foreground">
          AI 批改置信度不足的作答，以及学生对学习目标提出的申诉，都在这里处理
        </p>
      </div>

      {error ? (
        <p className="text-destructive">{error}</p>
      ) : !items ? (
        <Skeleton className="h-64" />
      ) : !items.length ? (
        <EmptyState title="暂无待复核作答" hint="低置信度或未批改的解答题会出现在这里" />
      ) : (
        <div className="space-y-3">
          {items.map((rec) => {
            const f = forms[rec.id];
            const busy = acting[rec.id];
            return (
              <Card key={rec.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{rec.studentName}</span>
                    <Badge variant="outline">{rec.className}</Badge>
                    <Link
                      href={`/teacher/assignments/${rec.assignmentId}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {rec.assignmentTitle}
                      <ExternalLink className="ml-0.5 inline h-3 w-3" />
                    </Link>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fmtDateTime(rec.submittedAt)} 提交
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">{TYPE_LABEL[rec.type] ?? rec.type} · </span>
                    {rec.stem}
                  </div>
                  {rec.options?.length ? (
                    <div className="text-muted-foreground">
                      {rec.options.map((o, i) => (
                        <span key={i} className="mr-3">
                          {String.fromCharCode(65 + i)}. {o}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">标准答案与解析</summary>
                    <div className="mt-1">
                      答案：{rec.answer}
                      {rec.analysis ? <div>解析：{rec.analysis}</div> : null}
                    </div>
                  </details>
                  <div className="rounded-md bg-muted/50 p-2">
                    <span className="font-medium">学生作答：</span>
                    {rec.response || "（空）"}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">AI 判分：</span>
                    {rec.score != null ? (
                      <>
                        {rec.isCorrect ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <Badge variant="outline">{pct(rec.score)}</Badge>
                        {rec.confidence != null ? (
                          <ConfidenceBadge confidence={rec.confidence} />
                        ) : null}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        未判分
                      </Badge>
                    )}
                  </div>
                  {rec.errorTags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {rec.errorTags.map((t) => (
                        <Badge key={t} variant="destructive" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {rec.errorAnalysis ? (
                    <div className="text-xs text-muted-foreground">归因：{rec.errorAnalysis}</div>
                  ) : null}
                  {rec.improvement ? (
                    <div className="text-xs text-muted-foreground">建议：{rec.improvement}</div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {rec.score != null ? (
                      <Button size="sm" disabled={busy} onClick={() => confirm(rec)}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        确认 AI 判分
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleForm(rec)}>
                      改判
                    </Button>
                  </div>

                  {f?.open ? (
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">判分：</span>
                        <Button
                          size="sm"
                          variant={f.isCorrect ? "default" : "outline"}
                          onClick={() => setForms((p) => ({ ...p, [rec.id]: { ...f, isCorrect: true } }))}
                        >
                          对
                        </Button>
                        <Button
                          size="sm"
                          variant={!f.isCorrect ? "destructive" : "outline"}
                          onClick={() => setForms((p) => ({ ...p, [rec.id]: { ...f, isCorrect: false } }))}
                        >
                          错
                        </Button>
                        <label className="ml-2 flex items-center gap-1.5 text-sm">
                          得分
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            className="w-20"
                            value={f.scorePct}
                            onChange={(e) =>
                              setForms((p) => ({
                                ...p,
                                [rec.id]: { ...f, scorePct: Number(e.target.value) || 0 },
                              }))
                            }
                          />
                          %
                        </label>
                      </div>
                      <Textarea
                        placeholder="复核说明（可选，将覆盖 AI 归因）"
                        value={f.errorAnalysis}
                        onChange={(e) =>
                          setForms((p) => ({ ...p, [rec.id]: { ...f, errorAnalysis: e.target.value } }))
                        }
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" disabled={busy} onClick={() => saveOverride(rec)}>
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          保存复核结果
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleForm(rec)}>
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 第二个队列：学习目标申诉 */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <MessageSquareWarning className="h-5 w-5" />
        <h2 className="text-xl font-semibold">目标申诉</h2>
        <Badge variant="secondary">{appeals?.length ?? 0}</Badge>
        <Select
          value={classFilter}
          onValueChange={(v) => {
            setClassFilter(v);
            loadAppeals(v);
          }}
        >
          <SelectTrigger className="ml-auto w-44">
            <SelectValue placeholder="选择班级" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部班级</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {appealError ? (
        <p className="text-destructive">{appealError}</p>
      ) : !appeals ? (
        <Skeleton className="h-40" />
      ) : !appeals.length ? (
        <EmptyState title="暂无目标申诉" hint="学生对学习目标提出申诉后会出现在这里" />
      ) : (
        <div className="space-y-3">
          {appeals.map((item) => {
            const busy = appealActing[item.id];
            return (
              <Card key={item.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{item.studentName}</span>
                    <Badge variant="outline">{item.className}</Badge>
                    <Link
                      href={`/teacher/students/${item.studentId}`}
                      className="text-muted-foreground hover:underline"
                    >
                      查看学生
                      <ExternalLink className="ml-0.5 inline h-3 w-3" />
                    </Link>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {item.appealRequestedAt ? `${fmtDateTime(item.appealRequestedAt)} 申诉` : "已申诉"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="rounded-md border p-2.5">{item.content}</div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <span className="font-medium">申诉理由：</span>
                    {item.appealReason || "（未填写）"}
                  </div>
                  <Textarea
                    placeholder="回复/说明（可选，学生可见）"
                    value={appealReplies[item.id] ?? ""}
                    onChange={(e) =>
                      setAppealReplies((p) => ({ ...p, [item.id]: e.target.value }))
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button size="sm" disabled={busy} onClick={() => resolveAppeal(item, "accept")}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      采纳（视为达成）
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => resolveAppeal(item, "reject")}
                    >
                      <X className="h-3.5 w-3.5" />
                      驳回
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
