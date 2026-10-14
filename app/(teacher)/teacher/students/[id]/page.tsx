"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Link2, MessageSquareWarning, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EChart } from "@/components/charts/echart";
import { StatCard } from "@/components/app/stat-card";
import { TierBadge } from "@/components/app/tier-badge";
import { lineOption } from "@/lib/charts";
import { effectiveTierOf } from "@/lib/tier";
import { fmtDateTime, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface MasteryItem {
  kpId: string;
  kpCode: string;
  kpName: string;
  value: number;
  history: { value: number; at: string }[];
}
interface SubjectGroup {
  subject: { code: string; name: string };
  avg: number;
  items: MasteryItem[];
}
interface StudentData {
  student: { id: string; name: string; className: string | null; tierOverride: string | null };
  mastery: SubjectGroup[];
  goals: {
    id: string;
    content: string;
    done: boolean;
    appealStatus: "NONE" | "PENDING" | "ACCEPTED" | "REJECTED";
    appealReason?: string | null;
    appealReply?: string | null;
  }[];
  wrongCount: number;
  submissions: {
    id: string;
    assignmentTitle: string;
    submittedAt: string;
    avgScore: number | null;
  }[];
}
interface Suggestion {
  summary: string;
  strengths: string[];
  gaps: string[];
  actions: { kpCode: string; kpName: string; action: string; reason: string }[];
}
interface ShareLinkInfo {
  id: string;
  createdAt: string;
  revoked: boolean;
  revokedAt: string | null;
  lastViewedAt: string | null;
}

function HistoryChart({ items }: { items: MasteryItem[] }) {
  const option = useMemo(() => {
    // 按时间点对齐各知识点轨迹
    const times = [...new Set(items.flatMap((i) => i.history.map((h) => h.at)))].sort();
    return lineOption({
      xLabels: times.map((t) => {
        const d = new Date(t);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      }),
      series: items.map((i) => {
        const byTime = new Map(i.history.map((h) => [h.at, h.value]));
        return { name: `${i.kpCode} ${i.kpName}`, data: times.map((t) => byTime.get(t) ?? null) };
      }),
    });
  }, [items]);
  return <EChart option={option} height={220} />;
}

export default function StudentDetailPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [data, setData] = useState<StudentData | null>(null);
  const [error, setError] = useState("");
  const [suggestSubject, setSuggestSubject] = useState("math");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [shareLinks, setShareLinks] = useState<ShareLinkInfo[]>([]);
  const [newShareUrl, setNewShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/students/${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
        if (j.mastery?.length) setSuggestSubject(j.mastery[0].subject.code);
      })
      .catch((e) => setError(e.message));
    loadShareLinks();
  }, [id]);

  async function loadShareLinks() {
    fetch(`/api/teacher/share-links?studentId=${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (r.ok) setShareLinks(Array.isArray(j.links) ? j.links : []);
      })
      .catch(() => {});
  }

  async function createShareLink() {
    setShareBusy(true);
    setNewShareUrl("");
    try {
      const r = await fetch("/api/teacher/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "创建失败");
      setNewShareUrl(`${window.location.origin}${j.link.url}`);
      toast.success("链接已生成，请立即复制保存");
      await loadShareLinks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShareLink(linkId: string) {
    setShareBusy(true);
    try {
      const r = await fetch(`/api/teacher/share-links?id=${linkId}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "撤销失败");
      toast.success("链接已撤销");
      await loadShareLinks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "撤销失败");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareUrl() {
    if (!newShareUrl) return;
    try {
      await navigator.clipboard.writeText(newShareUrl);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  }

  async function getSuggestion() {
    setSuggesting(true);
    setSuggestion(null);
    try {
      const r = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: id, subjectCode: suggestSubject }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "生成失败");
      setSuggestion(j);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      setSuggesting(false);
    }
  }

  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96" />;

  const avgAll = data.mastery.length
    ? data.mastery.reduce((a, g) => a + g.avg, 0) / data.mastery.length
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher">
            <ArrowLeft className="h-4 w-4" />
            返回看板
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">{data.student.name}</h1>
        <span className="text-sm text-muted-foreground">{data.student.className}</span>
        <TierBadge tier={effectiveTierOf(avgAll, data.student.tierOverride)} />
        {data.student.tierOverride && (
          <Badge variant="secondary">分层已锁定</Badge>
        )}
        <Badge variant="outline">未攻克错题 {data.wrongCount}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="综合平均掌握度" value={pct(avgAll)} />
        <StatCard label="提交作业" value={`${data.submissions.length} 次`} />
        <StatCard label="学习目标" value={`${data.goals.length} 个`} />
        <StatCard
          label="目标申诉"
          value={`${data.goals.filter((g) => g.appealStatus === "PENDING").length} 个`}
          hint={data.goals.some((g) => g.appealStatus === "PENDING") ? "需教师复核" : undefined}
        />
      </div>

      {/* 各科目掌握度 */}
      {data.mastery.map((g) => (
        <Card key={g.subject.code}>
          <CardHeader>
            <CardTitle className="text-base">
              {g.subject.name} 掌握度 <span className="ml-2 text-sm font-normal text-muted-foreground">平均 {pct(g.avg)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {g.items.map((m) => (
                <div key={m.kpId} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>
                      {m.kpCode} {m.kpName}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{pct(m.value)}</span>
                  </div>
                  <Progress value={m.value * 100} />
                </div>
              ))}
            </div>
            <HistoryChart items={g.items} />
          </CardContent>
        </Card>
      ))}

      {/* AI 培养建议 */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">AI 培养建议（可解释、可执行；教师最终决策）</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm max-sm:h-9"
              value={suggestSubject}
              onChange={(e) => setSuggestSubject(e.target.value)}
            >
              {data.mastery.map((g) => (
                <option key={g.subject.code} value={g.subject.code}>
                  {g.subject.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={getSuggestion} disabled={suggesting} className="gap-1.5">
              <Sparkles className="h-4 w-4" />
              {suggesting ? "生成中…" : suggestion ? "重新生成" : "生成建议"}
            </Button>
          </div>
        </CardHeader>
        {suggestion ? (
          <CardContent className="space-y-3 text-sm">
            <p className="rounded-md bg-muted p-3">{suggestion.summary}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 font-medium text-emerald-700">优势</div>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  {suggestion.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 font-medium text-amber-700">薄弱点</div>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  {suggestion.gaps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="space-y-2">
              <div className="font-medium">行动建议</div>
              {suggestion.actions.map((a, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {a.kpCode} {a.kpName}
                    </Badge>
                    <span className="font-medium">{a.action}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">依据：{a.reason}</div>
                </div>
              ))}
            </div>
          </CardContent>
        ) : null}
      </Card>

      {/* 目标与申诉 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">学生目标</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!data.goals.length ? <p className="text-sm text-muted-foreground">暂无目标。</p> : null}
          {data.goals.map((g) => (
            <div key={g.id} className="rounded-md border p-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className={g.done ? "text-muted-foreground line-through" : ""}>{g.content}</span>
                <div className="ml-auto flex shrink-0 gap-2">
                  {g.done ? <Badge variant="secondary">已完成</Badge> : <Badge variant="outline">进行中</Badge>}
                  {g.appealStatus === "PENDING" ? (
                    <Badge variant="destructive" className="gap-1">
                      <MessageSquareWarning className="h-3 w-3" />
                      已申诉·待复核
                    </Badge>
                  ) : null}
                  {g.appealStatus === "ACCEPTED" ? (
                    <Badge variant="secondary">申诉已通过</Badge>
                  ) : null}
                  {g.appealStatus === "REJECTED" ? <Badge variant="outline">申诉未通过</Badge> : null}
                </div>
              </div>
              {g.appealReply ? (
                <div className="mt-1.5 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  教师回复：{g.appealReply}
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 提交记录 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">提交记录</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!data.submissions.length ? (
            <p className="text-sm text-muted-foreground">暂无提交。</p>
          ) : null}
          {data.submissions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-md border p-2.5 text-sm">
              <span className="font-medium">{s.assignmentTitle}</span>
              <span className="text-xs text-muted-foreground">{fmtDateTime(s.submittedAt)}</span>
              {s.avgScore != null ? (
                <Badge className="ml-auto" variant={s.avgScore >= 0.8 ? "default" : s.avgScore >= 0.6 ? "secondary" : "destructive"}>
                  {pct(s.avgScore)}
                </Badge>
              ) : (
                <Badge className="ml-auto" variant="outline">
                  待批改
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 家长分享链接 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            家长分享链接
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={createShareLink} disabled={shareBusy}>
              生成分享链接
            </Button>
            <span className="text-xs text-muted-foreground">
              家长无需登录即可查看该生的成长档案（只读）。链接仅生成时显示一次，请立即复制。
            </span>
          </div>
          {newShareUrl && (
            <div className="flex items-center gap-2">
              <Input readOnly value={newShareUrl} className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={copyShareUrl}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                复制
              </Button>
            </div>
          )}
          {shareLinks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">已生成的链接</p>
              {shareLinks.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2.5 text-sm">
                  <span className="text-xs text-muted-foreground">创建于 {fmtDateTime(l.createdAt)}</span>
                  {l.lastViewedAt && (
                    <span className="text-xs text-muted-foreground">最近查看 {fmtDateTime(l.lastViewedAt)}</span>
                  )}
                  {l.revoked ? (
                    <Badge className="ml-auto" variant="outline">
                      已撤销
                    </Badge>
                  ) : (
                    <Button
                      className="ml-auto"
                      variant="outline"
                      size="sm"
                      disabled={shareBusy}
                      onClick={() => revokeShareLink(l.id)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      撤销
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
