"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EChart } from "@/components/charts/echart";
import { lineOption } from "@/lib/charts";
import { pct } from "@/lib/utils";

export interface DemoTimelinePoint {
  label: string;
  classAvg: number;
}

/**
 * 演示周期回放：按轮次逐帧「画」出班级平均掌握度折线。
 * x 轴固定 5 轮、未播放的帧用 null 占位（lineOption 带 connectNulls），
 * EChart 对 option 变化做 notMerge 整替 + 内置 animation，形成平滑流动效果。
 */
export function DemoReplayDialog({
  open,
  onOpenChange,
  timeline,
  classNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeline: DemoTimelinePoint[];
  classNames: string[];
}) {
  const [frame, setFrame] = useState(0);
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    if (!open || !timeline.length) return;
    setFrame(0);
    const timer = setInterval(() => {
      setFrame((f) => {
        if (f >= timeline.length) {
          clearInterval(timer);
          return f;
        }
        return f + 1;
      });
    }, 800);
    return () => clearInterval(timer);
  }, [open, replayKey, timeline]);

  const option = useMemo(
    () =>
      lineOption({
        xLabels: timeline.map((t) => t.label),
        series: [
          {
            name: "班级平均掌握度",
            data: timeline.map((t, i) => (i < frame ? t.classAvg : null)),
          },
        ],
      }),
    [timeline, frame]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>演示周期回放</DialogTitle>
          <DialogDescription>
            近 2.5 周 × 5 轮作业后班级平均掌握度的变化 · {classNames.join("、")}
          </DialogDescription>
        </DialogHeader>
        <EChart option={option} height={260} />
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            第 {Math.min(frame, timeline.length)}/{timeline.length} 轮
          </span>
          {frame > 0 ? (
            <span className="tabular-nums font-medium text-foreground">
              当前平均 {pct(timeline[frame - 1]?.classAvg)}
            </span>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setFrame(0);
              setReplayKey((k) => k + 1);
            }}
          >
            {frame >= timeline.length ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {frame >= timeline.length ? "重播" : "重新播放"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
