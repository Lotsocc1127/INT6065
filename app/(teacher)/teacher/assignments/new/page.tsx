"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TIER_META, type Tier } from "@/lib/mastery";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface SubjectInfo {
  id: string;
  code: string;
  name: string;
}
interface ClassInfo {
  id: string;
  name: string;
}
interface KpInfo {
  id: string;
  code: string;
  name: string;
}
interface BankQuestion {
  id: string;
  stem: string;
  type: string;
  difficulty: number;
  kpCodes: string[];
  options: string[];
  answer: string;
  analysis: string | null;
}
interface GenQuestion {
  stem: string;
  type: string;
  options: string[] | null;
  answer: string;
  analysis: string;
  kpId: string;
  difficulty: number;
  tier: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  SINGLE_CHOICE: "选择题",
  FILL_BLANK: "填空题",
  OPEN_RESPONSE: "解答题",
};

export default function NewAssignmentPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [kps, setKps] = useState<KpInfo[]>([]);
  const [bank, setBank] = useState<BankQuestion[] | null>(null);
  const [bankLoading, setBankLoading] = useState(false);

  // 表单
  const [title, setTitle] = useState("");
  const [type, setType] = useState("HOMEWORK");
  const [subject, setSubject] = useState("math");
  const [classId, setClassId] = useState("");
  const [dueAt, setDueAt] = useState("");
  // 选题
  const [selected, setSelected] = useState<Map<string, BankQuestion>>(new Map());
  const [bankTier, setBankTier] = useState<Record<string, string | null>>({});
  const [generated, setGenerated] = useState<GenQuestion[]>([]);
  // 题库过滤
  const [kpFilter, setKpFilter] = useState("all");
  const [diffFilter, setDiffFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  // AI 对话框
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTier, setAiTier] = useState<Tier>("intermediate");
  const [aiKps, setAiKps] = useState<string[]>([]);
  const [aiCount, setAiCount] = useState(5);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<GenQuestion[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // 支持从看板带科目跳转（?subject=english），否则默认第一个科目（数学）
    const urlSubject = new URLSearchParams(window.location.search).get("subject");
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => {
        const list: SubjectInfo[] = Array.isArray(s) ? s : [];
        setSubjects(list);
        const preferred =
          urlSubject && list.some((x) => x.code === urlSubject) ? urlSubject : list[0]?.code;
        if (preferred) setSubject(preferred);
      })
      .catch(() => {});
    fetch("/api/classes")
      .then((r) => r.json())
      .then((c) => {
        if (Array.isArray(c) && c.length) setClassId(c[0].id);
        setClasses(Array.isArray(c) ? c : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setKps([]);
    setKpFilter("all");
    fetch(`/api/subjects/${subject}/knowledge-points`)
      .then((r) => r.json())
      .then((k) => setKps(Array.isArray(k) ? k : []))
      .catch(() => {});
  }, [subject]);

  const loadBank = useCallback(async () => {
    setBankLoading(true);
    try {
      const params = new URLSearchParams({ subject });
      if (kpFilter !== "all") params.set("kp", kpFilter);
      if (diffFilter !== "all") params.set("difficulty", diffFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (search.trim()) params.set("q", search.trim());
      const r = await fetch(`/api/questions?${params}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "加载失败");
      setBank(Array.isArray(j) ? j : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBankLoading(false);
    }
  }, [subject, kpFilter, diffFilter, typeFilter, search]);

  useEffect(() => {
    const t = setTimeout(loadBank, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadBank, search]);

  const toggleSelect = (q: BankQuestion) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(q.id)) next.delete(q.id);
      else next.set(q.id, q);
      return next;
    });
  };

  /** 层级下拉（全体 = 所有层级学生可见） */
  function TierSelect({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (v: string | null) => void;
  }) {
    return (
      <Select
        value={value ?? "all"}
        onValueChange={(v) => onChange(v === "all" ? null : v)}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全体可见</SelectItem>
          {(Object.keys(TIER_META) as Tier[]).map((t) => (
            <SelectItem key={t} value={t}>
              仅{TIER_META[t].short}层
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  function changeSubject(code: string) {
    setSubject(code);
    // 已选题 / AI 结果属于旧科目，切换科目后清空
    setSelected(new Map());
    setGenerated([]);
    setAiKps([]);
    setAiResult(null);
  }

  async function generateAi() {
    setAiLoading(true);
    setAiResult(null);
    try {
      const r = await fetch("/api/ai/homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectCode: subject,
          kpCodes: aiKps,
          tier: aiTier,
          count: aiCount,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      // 本次生成批次默认标注为所选层级（采纳后可逐题修改）
      const list = (Array.isArray(j.questions) ? j.questions : []) as GenQuestion[];
      setAiResult(list.map((q) => ({ ...q, tier: aiTier })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setAiLoading(false);
    }
  }

  async function submit() {
    if (!title.trim()) {
      toast.error("请填写作业标题");
      return;
    }
    if (!selected.size && !generated.length) {
      toast.error("请至少选择一道题（可手动选题或 AI 生成）");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type,
          subjectId: subjects.find((s) => s.code === subject)?.id,
          classId,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          questionIds: [...selected.keys()].map((id) => ({ id, tier: bankTier[id] ?? null })),
          questions: generated,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "布置失败");
      toast.success("作业已布置");
      router.push(`/teacher/assignments/${j.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "布置失败");
    } finally {
      setSubmitting(false);
    }
  }

  const aiPreviewQuestions = useMemo(() => aiResult ?? [], [aiResult]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>布置作业</CardTitle>
          <CardDescription>从题库选题，或使用 AI 按分层生成作业（生成后可在下方编辑，教师最终把关）</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-6">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="title">作业标题 *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：一元一次方程 · 第 2 周作业"
            />
          </div>
          <div className="space-y-2">
            <Label>科目</Label>
            <Select value={subject} onValueChange={changeSubject}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>类型</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HOMEWORK">作业</SelectItem>
                <SelectItem value="QUIZ">测验</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>班级</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger>
                <SelectValue placeholder="选择班级" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dueAt">截止日期</Label>
            <Input
              id="dueAt"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 已选题目 */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            已选题目（题库 {selected.size} 道 + AI 生成 {generated.length} 道）
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setAiOpen(true)} className="gap-1.5">
              <Sparkles className="h-4 w-4" />
              AI 分层出题
            </Button>
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting ? "布置中…" : "确认布置"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selected.size && !generated.length ? (
            <p className="text-sm text-muted-foreground">
              尚未选题。可在下方题库中勾选，或点击「AI 分层出题」。
            </p>
          ) : null}
          {generated.map((g, i) => (
            <div key={`g${i}`} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="secondary">AI 生成</Badge>
                <Badge variant="outline">{TYPE_LABEL[g.type] ?? g.type}</Badge>
                <Badge variant="outline">难度 {g.difficulty}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive"
                  onClick={() => setGenerated((prev) => prev.filter((_, x) => x !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                className="mb-2"
                value={g.stem}
                onChange={(e) =>
                  setGenerated((prev) => prev.map((x, x2) => (x2 === i ? { ...x, stem: e.target.value } : x)))
                }
              />
              <div className="mb-2 space-y-1.5">
                <Label className="text-xs text-muted-foreground">适用层级（分层作业：只对所选层级学生可见）</Label>
                <TierSelect
                  value={g.tier ?? null}
                  onChange={(v) =>
                    setGenerated((prev) => prev.map((x, x2) => (x2 === i ? { ...x, tier: v } : x)))
                  }
                />
              </div>
              {g.type === "SINGLE_CHOICE" ? (
                <div className="mb-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">选项（A-D）</Label>
                  {(g.options ?? []).map((o, oi) => (
                    <Input
                      key={oi}
                      className="text-sm"
                      value={o}
                      onChange={(e) =>
                        setGenerated((prev) =>
                          prev.map((x, x2) =>
                            x2 === i
                              ? {
                                  ...x,
                                  options: (x.options ?? []).map((v, vi) =>
                                    vi === oi ? e.target.value : v
                                  ),
                                }
                              : x
                          )
                        )
                      }
                    />
                  ))}
                </div>
              ) : null}
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">答案</Label>
                  <Input
                    value={g.answer}
                    onChange={(e) =>
                      setGenerated((prev) =>
                        prev.map((x, x2) => (x2 === i ? { ...x, answer: e.target.value } : x))
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">解析</Label>
                  <Input
                    value={g.analysis}
                    onChange={(e) =>
                      setGenerated((prev) =>
                        prev.map((x, x2) => (x2 === i ? { ...x, analysis: e.target.value } : x))
                      )
                    }
                  />
                </div>
              </div>
            </div>
          ))}
          {[...selected.values()].map((q) => (
            <div key={q.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap gap-2">
                  <Badge variant="outline">{TYPE_LABEL[q.type] ?? q.type}</Badge>
                  <Badge variant="outline">难度 {q.difficulty}</Badge>
                  {q.kpCodes.map((c) => (
                    <Badge key={c} variant="secondary">
                      {c}
                    </Badge>
                  ))}
                </div>
                <div>{q.stem}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <TierSelect
                  value={bankTier[q.id] ?? null}
                  onChange={(v) => setBankTier((p) => ({ ...p, [q.id]: v }))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSelect(q)}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 题库 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">题库</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-48"
              placeholder="搜索题干…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={kpFilter} onValueChange={setKpFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="知识点" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部知识点</SelectItem>
                {kps.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.code} {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={diffFilter} onValueChange={setDiffFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="难度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部难度</SelectItem>
                {[1, 2, 3, 4, 5].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    难度 {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="题型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部题型</SelectItem>
                <SelectItem value="SINGLE_CHOICE">选择题</SelectItem>
                <SelectItem value="FILL_BLANK">填空题</SelectItem>
                <SelectItem value="OPEN_RESPONSE">解答题</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {bankLoading ? <Skeleton className="h-40" /> : null}
          {bank && !bankLoading ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>题干</TableHead>
                  <TableHead className="w-20">题型</TableHead>
                  <TableHead className="w-20">知识点</TableHead>
                  <TableHead className="w-16 text-right">难度</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bank.map((q) => (
                  <TableRow
                    key={q.id}
                    className={cn("cursor-pointer", selected.has(q.id) && "bg-accent/60")}
                    onClick={() => toggleSelect(q)}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        readOnly
                        checked={selected.has(q.id)}
                        className="h-4 w-4 accent-foreground"
                      />
                    </TableCell>
                    <TableCell className="max-w-md">
                      {q.stem}
                      {q.type === "SINGLE_CHOICE" && q.options.length ? (
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {q.options.map((o, oi) => (
                            <div key={oi}>
                              {String.fromCharCode(65 + oi)}. {o}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{TYPE_LABEL[q.type] ?? q.type}</TableCell>
                    <TableCell>{q.kpCodes.join("、")}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.difficulty}</TableCell>
                  </TableRow>
                ))}
                {!bank.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState title="没有符合条件的题目" hint="试试调整筛选条件，或使用「AI 分层出题」生成新题目。" />
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {/* AI 分层出题对话框 */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI 分层作业生成
            </DialogTitle>
            <DialogDescription>
              当前科目：{subjects.find((s) => s.code === subject)?.name ?? subject}
              。按知识点与难度层级生成题目，生成后请逐题审校（教师最终决策权），再采纳。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>生成层级（题目仅该层级学生可见）</Label>
              <Select value={aiTier} onValueChange={(v) => setAiTier(v as Tier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIER_META) as Tier[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIER_META[t].label}（{TIER_META[t].requirement}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>题目数量</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={aiCount}
                onChange={(e) => setAiCount(Number(e.target.value) || 5)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>知识点（不选则覆盖全部）</Label>
              <div className="flex flex-wrap gap-1.5">
                {kps.map((k) => (
                  <Badge
                    key={k.id}
                    variant={aiKps.includes(k.code) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() =>
                      setAiKps((prev) =>
                        prev.includes(k.code) ? prev.filter((x) => x !== k.code) : [...prev, k.code]
                      )
                    }
                  >
                    {k.code} {k.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          {aiPreviewQuestions.length ? (
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
              {aiPreviewQuestions.map((q, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-2 text-sm">
                  <div className="mb-1 flex gap-2">
                    <Badge variant="outline">{TYPE_LABEL[q.type] ?? q.type}</Badge>
                    <Badge variant="outline">难度 {q.difficulty}</Badge>
                    {q.tier ? (
                      <Badge variant="secondary">仅{TIER_META[q.tier as Tier].short}层</Badge>
                    ) : null}
                  </div>
                  <div>{q.stem}</div>
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
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={generateAi}
              disabled={aiLoading}
              className="gap-1.5"
            >
              <Sparkles className="h-4 w-4" />
              {aiLoading ? "生成中…" : aiResult ? "重新生成" : "开始生成"}
            </Button>
            <Button
              disabled={!aiPreviewQuestions.length}
              onClick={() => {
                setGenerated((prev) => [...prev, ...aiPreviewQuestions]);
                setAiResult(null);
                setAiOpen(false);
                toast.success(`已加入 ${aiPreviewQuestions.length} 道 AI 题目，请审校后布置`);
              }}
            >
              采纳全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
