"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIER_META, type Tier } from "@/lib/mastery";

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

interface RemedialKp {
  kpId: string;
  code: string;
  name: string;
  wrongCount: number;
  studentCount: number;
}

interface GenQuestion {
  stem: string;
  type: string;
  options: string[] | null;
  answer: string;
  analysis: string;
  kpId: string;
  difficulty: number;
  tier: Tier;
}

/** 一键补救：聚合班级待补救知识点 → AI 生成变式题 → 预览审校 → 创建补救作业 */
export function RemedialDialog({
  open,
  onOpenChange,
  subject,
  classId,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subject: string; // 科目 code
  classId: string;
  className: string;
}) {
  const router = useRouter();
  const [kps, setKps] = useState<RemedialKp[]>([]);
  const [loadingKps, setLoadingKps] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tier, setTier] = useState<"auto" | Tier>("auto");
  const [perKp, setPerKp] = useState(2);
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState<GenQuestion[] | null>(null);
  const [failedKps, setFailedKps] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [creating, setCreating] = useState(false);

  // 打开时加载聚合与科目 id
  const load = useCallback(async () => {
    setLoadingKps(true);
    setQuestions(null);
    setFailedKps([]);
    setSelected([]);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/remedial/kps?subject=${subject}&classId=${classId}`),
        fetch("/api/subjects"),
      ]);
      const j1 = await r1.json();
      if (!r1.ok) throw new Error(j1.error ?? "加载失败");
      setKps(j1.items ?? []);
      const j2 = await r2.json();
      if (r2.ok) {
        const s = (j2 as { id: string; code: string }[]).find((x) => x.code === subject);
        if (s) setSubjectId(s.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingKps(false);
    }
  }, [subject, classId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const subjectName = useMemo(() => (subject === "math" ? "数学" : subject), [subject]);

  function toggle(kpId: string) {
    setSelected((p) => (p.includes(kpId) ? p.filter((x) => x !== kpId) : [...p, kpId]));
  }

  async function generate() {
    setGenerating(true);
    setQuestions(null);
    setFailedKps([]);
    try {
      const r = await fetch("/api/remedial/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectCode: subject, kpIds: selected, perKp, tier, classId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      setQuestions(j.questions);
      setFailedKps(j.failedKps ?? []);
      if (j.failedKps?.length) toast.warning(`部分知识点生成失败：${j.failedKps.join("、")}`);
      if (!title) setTitle(`${className}·${subjectName}补救练习`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function create() {
    if (!questions?.length || !subjectId) return;
    setCreating(true);
    try {
      const r = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || `${className}·${subjectName}补救练习`,
          type: "HOMEWORK",
          subjectId,
          classId,
          dueAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
          questions: questions.map((q) => ({
            stem: q.stem,
            type: q.type,
            options: q.options,
            answer: q.answer,
            analysis: q.analysis,
            kpId: q.kpId,
            difficulty: q.difficulty,
            tier: q.tier,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "布置失败");
      toast.success(`补救作业已布置（${questions.length} 道题，按层级自动分发）`);
      onOpenChange(false);
      router.push(`/teacher/assignments/${j.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "布置失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            变式补救作业
          </DialogTitle>
          <DialogDescription>
            {className} · {subjectName}。基于班级未攻克错题聚合出待补救知识点，AI 生成变式题
            （带独立验算），按学生层级自动分发。生成后请逐题审校再布置。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label>待补救知识点（按涉及学生数排序）</Label>
            {loadingKps ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 聚合错题数据中…
              </div>
            ) : kps.length ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {kps.map((k) => (
                    <Badge
                      key={k.kpId}
                      variant={selected.includes(k.kpId) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggle(k.kpId)}
                    >
                      {k.code} {k.name} · {k.studentCount} 人 {k.wrongCount} 次错
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(kps.slice(0, 3).map((k) => k.kpId))}
                >
                  全选 Top 3
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">该班级暂无未攻克的错题</p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>题目层级（仅该层级学生可见）</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as "auto" | Tier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动（按错题学生层级）</SelectItem>
                  {(Object.keys(TIER_META) as Tier[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIER_META[t].label}（{TIER_META[t].requirement}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>每知识点题数</Label>
              <Select value={String(perKp)} onValueChange={(v) => setPerKp(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 道</SelectItem>
                  <SelectItem value="2">2 道</SelectItem>
                  <SelectItem value="3">3 道</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {failedKps.length ? (
            <div className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
              部分知识点生成失败（{failedKps.join("、")}），可重新生成或先布置已成功的题目。
            </div>
          ) : null}

          {questions ? (
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-3">
              {questions.map((q, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-2 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{TYPE_LABEL[q.type] ?? q.type}</Badge>
                    <Badge variant="outline">难度 {q.difficulty}</Badge>
                    <Select
                      value={q.tier}
                      onValueChange={(v) =>
                        setQuestions((list) =>
                          list?.map((x, xi) => (xi === i ? { ...x, tier: v as Tier } : x)) ?? null
                        )
                      }
                    >
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TIER_META) as Tier[]).map((t) => (
                          <SelectItem key={t} value={t}>
                            仅{TIER_META[t].short}层
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-7 w-7"
                      onClick={() =>
                        setQuestions((list) => list?.filter((_, xi) => xi !== i) ?? null)
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Input
                    className="h-8"
                    value={q.stem}
                    onChange={(e) =>
                      setQuestions(
                        (list) =>
                          list?.map((x, xi) => (xi === i ? { ...x, stem: e.target.value } : x)) ??
                          null
                      )
                    }
                  />
                  {q.type === "SINGLE_CHOICE" && q.options?.length ? (
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {q.options.map((o, oi) => (
                        <div key={oi}>
                          {String.fromCharCode(65 + oi)}. {o}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-1 text-xs text-muted-foreground">答案：{q.answer}</div>
                  <div className="text-xs text-muted-foreground">解析：{q.analysis}</div>
                </div>
              ))}
            </div>
          ) : null}

          {questions ? (
            <div className="space-y-2">
              <Label>作业标题</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={generate}
            disabled={generating || !selected.length}
            className="gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            {generating ? "生成 + 验算中（约 30-90 秒）…" : questions ? "重新生成" : "开始生成"}
          </Button>
          <Button disabled={!questions?.length || creating} onClick={create}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            确认布置（{questions?.length ?? 0} 题）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
