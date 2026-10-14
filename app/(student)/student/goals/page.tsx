"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Flag, MessageSquareWarning, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Goal {
  id: string;
  content: string;
  kpId: string | null;
  done: boolean;
  appealStatus: "NONE" | "PENDING" | "ACCEPTED" | "REJECTED";
  appealReason: string | null;
  appealReply: string | null;
  createdAt: string;
}
interface KpInfo {
  id: string;
  code: string;
  name: string;
}

function GoalsPage() {
  const searchParams = useSearchParams();
  const subject = searchParams.get("subject") ?? "math";
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [kps, setKps] = useState<KpInfo[]>([]);
  const [content, setContent] = useState("");
  const [kpId, setKpId] = useState("none");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [appealTarget, setAppealTarget] = useState<Goal | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => setSubjects(Array.isArray(s) ? s : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // 知识点属于具体科目，切换科目后重置选择
    setKpId("none");
    fetch(`/api/subjects/${subject}/knowledge-points`)
      .then((r) => r.json())
      .then((k) => setKps(Array.isArray(k) ? k : []))
      .catch(() => {});
  }, [subject]);

  async function load() {
    fetch("/api/goals")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setGoals(Array.isArray(j) ? j : []);
      })
      .catch((e) => setError(e.message));
  }

  async function addGoal() {
    if (!content.trim()) {
      toast.error("请填写目标内容");
      return;
    }
    setAdding(true);
    try {
      const r = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), kpId: kpId === "none" ? null : kpId }),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error ?? "添加失败");
      }
      setContent("");
      toast.success("目标已设定，加油！");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  async function patch(g: Goal, body: { done?: boolean; action?: "appeal"; reason?: string }) {
    try {
      const r = await fetch(`/api/goals/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      setGoals((prev) =>
        (prev ?? []).map((x) => (x.id === g.id ? { ...x, ...j } : x))
      );
      if (body.action === "appeal") toast.success("已提交申诉，老师会复核这个目标");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
      return false;
    }
  }

  async function submitAppeal() {
    if (!appealTarget) return;
    setSubmitting(true);
    const okDone = await patch(appealTarget, { action: "appeal", reason: reason.trim() });
    setSubmitting(false);
    if (okDone) {
      setAppealTarget(null);
      setReason("");
    }
  }

  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      <SubjectSwitcher subjects={subjects} current={subject} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" />
            我的学习目标
          </CardTitle>
          <CardDescription>
            目标由我自己参与设定；如果觉得系统给我的标签/分层不准确，可以随时提出申诉，老师会复核。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-md"
              placeholder="如：本周每天完成 5 道解方程练习"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <Select value={kpId} onValueChange={setKpId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="关联知识点" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不关联知识点</SelectItem>
                {kps.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.code} {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={addGoal} disabled={adding} className="gap-1">
              <Plus className="h-4 w-4" />
              {adding ? "添加中…" : "设定目标"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!goals ? <Skeleton className="h-48" /> : null}
      {goals ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            {!goals.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                还没有目标，先给自己定一个小目标吧！
              </p>
            ) : null}
            {goals.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm", g.done && "text-muted-foreground line-through")}>
                    {g.content}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {g.done ? <Badge variant="secondary">已完成</Badge> : <Badge variant="outline">进行中</Badge>}
                    {g.appealStatus === "PENDING" ? (
                      <Badge variant="destructive" className="gap-1">
                        <MessageSquareWarning className="h-3 w-3" />
                        已申诉 · 待教师复核
                      </Badge>
                    ) : null}
                    {g.appealStatus === "ACCEPTED" ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        申诉已通过 · 视为达成
                      </Badge>
                    ) : null}
                    {g.appealStatus === "REJECTED" ? (
                      <Badge variant="outline" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        申诉未通过
                      </Badge>
                    ) : null}
                  </div>
                  {g.appealReason ? (
                    <div className="mt-1.5 text-xs text-muted-foreground">我的申诉理由：{g.appealReason}</div>
                  ) : null}
                  {g.appealReply ? (
                    <div className="mt-1.5 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                      教师回复：{g.appealReply}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {!g.done && g.appealStatus !== "PENDING" ? (
                    <Button size="sm" variant="outline" onClick={() => patch(g, { done: true })}>
                      标记完成
                    </Button>
                  ) : null}
                  {!g.done && (g.appealStatus === "NONE" || g.appealStatus === "REJECTED") ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => {
                        setReason("");
                        setAppealTarget(g);
                      }}
                    >
                      {g.appealStatus === "REJECTED" ? "再次申诉" : "提出申诉"}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={appealTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAppealTarget(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>对学习目标提出申诉</DialogTitle>
            <DialogDescription>
              说明你认为这个目标不合理的原因，老师会复核并回复。复核期间该目标暂不能标记完成。
            </DialogDescription>
          </DialogHeader>
          {appealTarget ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-2.5 text-sm">{appealTarget.content}</div>
              <Textarea
                rows={3}
                placeholder="如：我已经掌握了这部分内容，希望调整为……（选填）"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setAppealTarget(null);
                setReason("");
              }}
            >
              取消
            </Button>
            <Button onClick={submitAppeal} disabled={submitting}>
              {submitting ? "提交中…" : "提交申诉"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GoalsPageWrapper() {
  return (
    <Suspense>
      <GoalsPage />
    </Suspense>
  );
}
