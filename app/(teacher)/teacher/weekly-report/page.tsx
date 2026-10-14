"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, FileText, Loader2, TrendingDown, TrendingUp } from "lucide-react";
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
import { EChart } from "@/components/charts/echart";
import { StatCard } from "@/components/app/stat-card";
import { TierBadge, TierLegend } from "@/components/app/tier-badge";
import { hbarOption, lineOption } from "@/lib/charts";
import { TIER_META, type Tier } from "@/lib/mastery";
import { pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface WeeklyStats {
  subjectName: string;
  className: string;
  studentCount: number;
  range: { current: { from: string; to: string }; previous: { from: string; to: string } };
  assignmentCount: { current: number; previous: number };
  submissionRate: { current: number | null; previous: number | null };
  correctRate: { current: number | null; previous: number | null };
  weakKps: { code: string; name: string; classAvg: number }[];
  masteryTrend: { date: string; avg: number }[];
  trendDelta: number;
  errorTags: { tag: string; count: number }[];
  attentionStudents: {
    id: string;
    name: string;
    avg: number;
    trendDelta: number | null;
    reasons: string[];
  }[];
  tierDistribution: Record<Tier, number>;
}
interface ReportText {
  title: string;
  summary: string;
  suggestions: string[];
  aiGenerated: boolean;
  generatedAt: string;
}

function fmtRange(r: { from: string; to: string }): string {
  const f = new Date(r.from);
  const t = new Date(r.to);
  return `${f.getMonth() + 1}/${f.getDate()}–${t.getMonth() + 1}/${t.getDate()}`;
}

function reportToText(report: ReportText, stats: WeeklyStats): string {
  const lines: string[] = [];
  lines.push(`【学情周报】${report.title}`);
  lines.push("");
  lines.push(`班级：${stats.className}（${stats.studentCount} 人）· ${stats.subjectName}`);
  lines.push(
    `统计周期：本期 ${fmtRange(stats.range.current)}（对比上期 ${fmtRange(stats.range.previous)}）`
  );
  lines.push("");
  lines.push("【总结】");
  lines.push(report.summary);
  lines.push("");
  if (report.suggestions.length) {
    lines.push("【行动建议】");
    report.suggestions.forEach((s) => lines.push(`- ${s}`));
  }
  return lines.join("\n");
}

export default function WeeklyReportPage() {
  const [subjects, setSubjects] = useState<{ id: string; code: string; name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [subject, setSubject] = useState("math");
  const [classId, setClassId] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportText | null>(null);
  const [stats, setStats] = useState<WeeklyStats | null>(null);

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => {
        const list = Array.isArray(s) ? s : [];
        setSubjects(list);
        if (list.length) setSubject(list[0].code);
      })
      .catch(() => {});
    fetch("/api/classes")
      .then((r) => r.json())
      .then((c) => {
        const list = Array.isArray(c) ? c : [];
        setClasses(list);
        if (list.length) setClassId(list[0].id);
      })
      .catch(() => {});
  }, []);

  async function generate() {
    setLoading(true);
    setReport(null);
    setStats(null);
    try {
      const r = await fetch("/api/ai/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectCode: subject, classId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      setReport(j.report as ReportText);
      setStats(j.stats as WeeklyStats);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  function update(patch: Partial<ReportText>) {
    setReport((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function copy() {
    if (!report || !stats) return;
    try {
      await navigator.clipboard.writeText(reportToText(report, stats));
      toast.success("周报已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  }

  const trendOption = useMemo(() => {
    if (!stats) return null;
    return lineOption({
      xLabels: stats.masteryTrend.map((t) => t.date),
      series: [{ name: "班级平均掌握度", data: stats.masteryTrend.map((t) => t.avg) }],
    });
  }, [stats]);

  const tagsOption = useMemo(() => {
    if (!stats) return null;
    return hbarOption({
      categories: stats.errorTags.map((t) => t.tag),
      name: "次数",
      data: stats.errorTags.map((t) => t.count),
      valueFormatter: (v: number) => `${v} 次`,
    });
  }, [stats]);

  const cmpHint = (cur: number | null, prev: number | null) =>
    prev === null
      ? "上期无数据"
      : `上期 ${pct(prev)}${
          cur !== null
            ? ` · ${cur >= prev ? "↑" : "↓"} ${pct(Math.abs(cur - prev))}`
            : ""
        }`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            AI 班级学情周报
          </CardTitle>
          <CardDescription>
            对比近 7 天与前 7 天：提交率、正确率、掌握度趋势、薄弱知识点、高频错因与待关注学生。周报仅供教学参考，请审核修改后使用（AI 不作教学决策）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>科目</Label>
            <Select value={subject} onValueChange={setSubject}>
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
                <SelectValue />
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
          <div className="flex items-end gap-2">
            <Button onClick={generate} disabled={loading || !classId}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "生成中…" : report ? "重新生成" : "生成周报"}
            </Button>
            {report && (
              <Button variant="outline" onClick={copy}>
                <Copy className="mr-1.5 h-4 w-4" />
                复制文字版
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!report && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            选择科目与班级后点击「生成周报」。未配置 AI Key 时自动使用模板文本。
          </CardContent>
        </Card>
      )}

      {report && stats && (
        <>
          {/* 对比指标 */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="提交率（本期）"
              value={stats.submissionRate.current === null ? "无数据" : pct(stats.submissionRate.current)}
              hint={cmpHint(stats.submissionRate.current, stats.submissionRate.previous)}
            />
            <StatCard
              label="正确率（本期）"
              value={stats.correctRate.current === null ? "无数据" : pct(stats.correctRate.current)}
              hint={cmpHint(stats.correctRate.current, stats.correctRate.previous)}
            />
            <StatCard label="薄弱知识点" value={`${stats.weakKps.length} 个`} />
            <StatCard label="待关注学生" value={`${stats.attentionStudents.length} 人`} />
          </div>

          {/* 趋势 + 错因 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">近两周掌握度趋势</CardTitle>
              </CardHeader>
              <CardContent>
                {trendOption && <EChart option={trendOption} height={220} />}
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  {stats.trendDelta >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                  两周净变化 {pct(Math.abs(stats.trendDelta))}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">高频错因（本期）</CardTitle>
              </CardHeader>
              <CardContent>
                {tagsOption ? (
                  <EChart option={tagsOption} height={220} />
                ) : (
                  <p className="text-sm text-muted-foreground">本周期暂无作答数据</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 薄弱点 / 分层 / 关注学生 */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4" />
                  共性薄弱知识点
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {stats.weakKps.length ? (
                  stats.weakKps.map((k) => (
                    <Badge key={k.code} variant="outline">
                      {k.code} {k.name}（{pct(k.classAvg)}）
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">无（均在 60% 以上）</span>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">分层分布</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(Object.keys(TIER_META) as Tier[]).map((t) => (
                  <div key={t} className="flex items-center justify-between">
                    <TierBadge tier={t} />
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {stats.tierDistribution[t]} 人
                    </span>
                  </div>
                ))}
                <TierLegend />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">待关注学生</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {stats.attentionStudents.length ? (
                  stats.attentionStudents.map((s) => (
                    <div key={s.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.name}</span>
                        <span className="tabular-nums text-muted-foreground">{pct(s.avg)}</span>
                      </div>
                      <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                        {s.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">暂无</span>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 可编辑周报文本 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>周报文本（可编辑）</span>
                <Badge variant="outline">
                  {report.aiGenerated ? "AI 生成" : "模板生成（未配置 AI Key）"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-title">标题</Label>
                <Input
                  id="report-title"
                  value={report.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-summary">总结</Label>
                <Textarea
                  id="report-summary"
                  rows={4}
                  value={report.summary}
                  onChange={(e) => update({ summary: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-suggestions">行动建议（每行一条）</Label>
                <Textarea
                  id="report-suggestions"
                  rows={5}
                  value={report.suggestions.join("\n")}
                  onChange={(e) => update({ suggestions: e.target.value.split("\n") })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                生成时间：{new Date(report.generatedAt).toLocaleString("zh-CN")}。周报仅用于教学参考，教师最终决策。
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
