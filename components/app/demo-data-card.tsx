"use client";

import { useState } from "react";
import { FlaskConical, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DemoReplayDialog, type DemoTimelinePoint } from "@/components/app/demo-replay-dialog";

interface DemoSummary {
  classes: number;
  classNames: string[];
  assignments: number;
  submissions: number;
  answers: number;
  pendingReview: number;
  timeline: DemoTimelinePoint[];
}

/**
 * 一键演示数据（教师端看板）：
 * 生成近 2.5 周 × 5 轮数学演示教学周期（写入前 3 个有学生的班级，可整批清除）。
 * 生成/清除后回调 onChanged 让看板自动刷新；生成成功自动弹出「演示周期回放」。
 */
export function DemoDataCard({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<"generate" | "clear" | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState<DemoSummary | null>(null);

  async function doDemo(mode: "generate" | "clear") {
    setBusy(true);
    try {
      const r = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      if (mode === "generate") {
        const summary = j as DemoSummary;
        setLastSummary(summary);
        toast.success(
          `演示数据已生成：${summary.classNames.join("、")}（${summary.assignments} 份作业 / ${summary.submissions} 份提交），看板已刷新`
        );
        setReplayOpen(true);
      } else {
        toast.success("演示数据已清除，真实数据不受影响，看板已刷新");
      }
      setConfirmOpen(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            演示数据
          </CardTitle>
          <CardDescription>
            一键生成近 2.5 周 × 5 轮的数学演示教学周期（写入前 3 个有学生的班级，作业带「演示」徽章），
            生成后本看板与「作业管理」「待复核」即时可见，并自动播放掌握度变化回放；与真实数据可随时隔离清除。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setConfirmOpen("generate")}
            disabled={busy}
            className="gap-1.5"
          >
            <FlaskConical className="h-4 w-4" />
            {busy ? "处理中…" : "生成演示数据"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirmOpen("clear")}
            disabled={busy}
            className="gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            清除演示数据
          </Button>
          {lastSummary ? (
            <Button
              variant="ghost"
              onClick={() => setReplayOpen(true)}
              disabled={busy}
              className="gap-1.5"
            >
              <Play className="h-4 w-4" />
              回放上次演示周期
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* 生成/清除确认对话框 */}
      <Dialog open={Boolean(confirmOpen)} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmOpen === "generate" ? "生成演示数据" : "清除演示数据"}</DialogTitle>
            <DialogDescription>
              {confirmOpen === "generate"
                ? "将清理并重建前 3 个有学生班级近 2.5 周的数学演示数据（作业、提交、掌握度历史与错题本），不影响任何真实数据。生成需要几秒钟，请勿关闭页面。"
                : "将清除全部演示数据，并把受影响的掌握度回退到演示前的状态。真实数据不受影响。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(null)} disabled={busy}>
              取消
            </Button>
            <Button onClick={() => confirmOpen && doDemo(confirmOpen)} disabled={busy}>
              {busy ? "处理中…" : confirmOpen === "generate" ? "确认生成" : "确认清除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 演示周期回放 */}
      <DemoReplayDialog
        open={replayOpen}
        onOpenChange={setReplayOpen}
        timeline={lastSummary?.timeline ?? []}
        classNames={lastSummary?.classNames ?? []}
      />
    </>
  );
}
