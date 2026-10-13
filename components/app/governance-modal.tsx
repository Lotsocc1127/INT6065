"use client";

import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

const ITEMS: { title: string; desc: string }[] = [
  { title: "隐私与监控", desc: "只采集与学习相关的必要字段，目的明确；学生/家长可查看；数据不外泄。" },
  { title: "知情同意", desc: "首次使用展示数据使用说明；未成年人需监护人同意。" },
  { title: "标签固化/轨道锁定", desc: "分层动态、可流动；不做“能力强弱”定性；标签可申诉、可更新。" },
  { title: "偏见与公平", desc: "分层结果跨群体核查；定期公平性审计。" },
  { title: "透明与问责", desc: "每条建议可解释；AI 仅辅助，教师可修改/否决并负责。" },
  { title: "学业依赖", desc: "苏格拉底辅导不给答案；高阶认知（分析/评价/创造）留给学生。" },
  { title: "数字鸿沟", desc: "多终端可用；提供必要设备/离线方案。" },
  { title: "AI 备课助手", desc: "教案仅供备课参考，教师须审核修改后使用，AI 不作教学决策。" },
];

export function GovernanceModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ShieldCheck className="h-4 w-4" />
          数据治理
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            数据治理与伦理承诺
          </DialogTitle>
          <DialogDescription>
            从「监控」到「形成性赋能」：数据用于促进学习，而非贴标签、定优劣。AI
            输出均可编辑、否决，教师是最终决策者。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="rounded-md bg-muted p-3 text-muted-foreground">
            数据使用说明：本系统仅采集与学习相关的必要数据（作业作答、用时、掌握度、错题），
            用于个性化学习支持与教学诊断；学生与监护人可随时查看，标签可申诉、可更新。
          </p>
          <Separator />
          {ITEMS.map((it) => (
            <div key={it.title} className="flex gap-3">
              <span className="shrink-0 font-medium">{it.title}</span>
              <span className="text-muted-foreground">{it.desc}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
