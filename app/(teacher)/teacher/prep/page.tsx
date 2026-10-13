"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
interface FlowStage {
  stage: string;
  duration: number;
  intent: string;
  content: string;
}
interface PedagogyItem {
  theory: string;
  application: string;
}
interface PrepResult {
  title: string;
  targets: string[];
  keyPoints: string[];
  difficulties: string[];
  flow: FlowStage[];
  pedagogy: PedagogyItem[];
  boardDesign: string;
  homework: string;
  preview: string;
}

/** 教案 → 纯文本（用于复制） */
function prepToText(p: PrepResult): string {
  const lines: string[] = [];
  lines.push(`【教案】${p.title}`);
  lines.push("");
  if (p.targets.length) {
    lines.push("【教学目标】");
    p.targets.forEach((t) => lines.push(`- ${t}`));
    lines.push("");
  }
  if (p.keyPoints.length) {
    lines.push("【教学重点】");
    p.keyPoints.forEach((t) => lines.push(`- ${t}`));
    lines.push("");
  }
  if (p.difficulties.length) {
    lines.push("【教学难点】");
    p.difficulties.forEach((t) => lines.push(`- ${t}`));
    lines.push("");
  }
  if (p.flow.length) {
    lines.push("【教学过程】");
    p.flow.forEach((f) => {
      lines.push(`■ ${f.stage}（${f.duration} 分钟）`);
      if (f.intent) lines.push(`设计意图：${f.intent}`);
      lines.push(f.content);
      lines.push("");
    });
  }
  if (p.pedagogy.length) {
    lines.push("【教学方法依据】");
    p.pedagogy.forEach((pg) => lines.push(`- ${pg.theory}：${pg.application}`));
    lines.push("");
  }
  if (p.boardDesign) {
    lines.push("【板书设计】");
    lines.push(p.boardDesign);
    lines.push("");
  }
  if (p.homework) {
    lines.push("【课后作业（分层）】");
    lines.push(p.homework);
    lines.push("");
  }
  if (p.preview) {
    lines.push("【预习任务】");
    lines.push(p.preview);
  }
  return lines.join("\n");
}

export default function PrepPage() {
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [kps, setKps] = useState<KpInfo[]>([]);
  const [subject, setSubject] = useState("math");
  const [classId, setClassId] = useState("");
  const [kpCodes, setKpCodes] = useState<string[]>([]);
  const [lessons, setLessons] = useState(1);
  const [requirement, setRequirement] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PrepResult | null>(null);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => {
        const list: SubjectInfo[] = Array.isArray(s) ? s : [];
        setSubjects(list);
        if (list.length) setSubject(list[0].code);
      })
      .catch(() => {});
    fetch("/api/classes")
      .then((r) => r.json())
      .then((c) => {
        const list: ClassInfo[] = Array.isArray(c) ? c : [];
        setClasses(list);
        if (list.length) setClassId(list[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setKpCodes([]);
    fetch(`/api/subjects/${subject}/knowledge-points`)
      .then((r) => r.json())
      .then((k) => setKps(Array.isArray(k) ? k : []))
      .catch(() => {});
  }, [subject]);

  async function generate() {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/ai/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectCode: subject,
          classId,
          kpCodes,
          lessons,
          requirement: requirement.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      setResult(j.prep as PrepResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  function update(patch: Partial<PrepResult>) {
    setResult((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function updateFlow(i: number, patch: Partial<FlowStage>) {
    setResult((prev) =>
      prev ? { ...prev, flow: prev.flow.map((f, x) => (x === i ? { ...f, ...patch } : f)) } : prev
    );
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(prepToText(result));
      toast.success("教案已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  }

  const subjectName = subjects.find((s) => s.code === subject)?.name ?? subject;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI 备课助手
          </CardTitle>
          <CardDescription>
            基于班级真实学情（分层分布、各知识点掌握度、薄弱点、作业提交与高频错因）生成教案。
            教案仅供备课参考，请审核修改后使用（AI 不作教学决策）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>科目</Label>
            <Select
              value={subject}
              onValueChange={(v) => {
                setSubject(v);
                setResult(null);
              }}
            >
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
            <Label htmlFor="lessons">课时数（每课时 40 分钟）</Label>
            <Input
              id="lessons"
              type="number"
              min={1}
              max={8}
              value={lessons}
              onChange={(e) => setLessons(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label>知识点（不选则覆盖全部）</Label>
            <div className="flex flex-wrap gap-1.5">
              {kps.map((k) => (
                <Badge
                  key={k.id}
                  variant={kpCodes.includes(k.code) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() =>
                    setKpCodes((prev) =>
                      prev.includes(k.code) ? prev.filter((x) => x !== k.code) : [...prev, k.code]
                    )
                  }
                >
                  {k.code} {k.name}
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label htmlFor="requirement">补充要求（可选，如：重点突破有理数混合运算、安排一次小组活动）</Label>
            <Textarea
              id="requirement"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="写下你的备课要求，AI 会据此调整教案……"
              rows={2}
            />
          </div>
          <div className="md:col-span-3">
            <Button onClick={generate} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? "生成中…" : result ? "重新生成" : "生成教案"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">教案（可编辑）· {subjectName}</CardTitle>
            <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
              <Copy className="h-4 w-4" />
              复制教案
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prep-title">教案标题</Label>
              <Input
                id="prep-title"
                value={result.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </div>
            {(
              [
                ["targets", "教学目标（每行一条）"],
                ["keyPoints", "教学重点（每行一条）"],
                ["difficulties", "教学难点（每行一条）"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`prep-${key}`}>{label}</Label>
                <Textarea
                  id={`prep-${key}`}
                  rows={3}
                  value={result[key].join("\n")}
                  onChange={(e) => update({ [key]: e.target.value.split("\n") })}
                />
              </div>
            ))}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>教学过程（环节 / 分钟 / 设计意图 / 内容）</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update({
                      flow: [...result.flow, { stage: "新环节", duration: 5, intent: "", content: "" }],
                    })
                  }
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" />
                  添加环节
                </Button>
              </div>
              {result.flow.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_5rem_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">环节名称</Label>
                    <Input value={f.stage} onChange={(e) => updateFlow(i, { stage: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">分钟</Label>
                    <Input
                      type="number"
                      min={1}
                      max={45}
                      value={f.duration}
                      onChange={(e) =>
                        updateFlow(i, {
                          duration: Math.min(45, Math.max(1, Number(e.target.value) || 5)),
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-end text-destructive"
                    onClick={() => update({ flow: result.flow.filter((_, x) => x !== i) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Textarea
                    className="md:col-span-3"
                    rows={1}
                    placeholder="设计意图：本环节依据的教学理论/策略（如：脚手架、先行组织者……）"
                    value={f.intent}
                    onChange={(e) => updateFlow(i, { intent: e.target.value })}
                  />
                  <Textarea
                    className="md:col-span-3"
                    rows={2}
                    placeholder="本环节的师生活动要点……"
                    value={f.content}
                    onChange={(e) => updateFlow(i, { content: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>教学方法依据（理论 / 在本教案中的落地方式）</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update({ pedagogy: [...result.pedagogy, { theory: "", application: "" }] })
                  }
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" />
                  添加依据
                </Button>
              </div>
              {result.pedagogy.map((pg, i) => (
                <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_2fr_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">教学理论</Label>
                    <Input
                      value={pg.theory}
                      placeholder="如：最近发展区（ZPD）"
                      onChange={(e) =>
                        update({
                          pedagogy: result.pedagogy.map((x, xi) =>
                            xi === i ? { ...x, theory: e.target.value } : x
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">落地方式</Label>
                    <Input
                      value={pg.application}
                      placeholder="如：例题设三级台阶，搭脚手架逐步撤除"
                      onChange={(e) =>
                        update({
                          pedagogy: result.pedagogy.map((x, xi) =>
                            xi === i ? { ...x, application: e.target.value } : x
                          ),
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-end text-destructive"
                    onClick={() => update({ pedagogy: result.pedagogy.filter((_, xi) => xi !== i) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            {(
              [
                ["boardDesign", "板书设计", 3],
                ["homework", "课后作业（分层）", 4],
                ["preview", "预习任务", 3],
              ] as const
            ).map(([key, label, rows]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`prep-${key}`}>{label}</Label>
                <Textarea
                  id={`prep-${key}`}
                  rows={rows}
                  value={result[key]}
                  onChange={(e) => update({ [key]: e.target.value })}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
