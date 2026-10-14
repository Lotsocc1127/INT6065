"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EChart } from "@/components/charts/echart";
import { BrandLogo } from "@/components/app/brand-logo";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { TierBadge } from "@/components/app/tier-badge";
import { lineOption, radarOption } from "@/lib/charts";
import type { Tier } from "@/lib/mastery";
import { fmtDuration, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ShareData {
  student: { name: string; className: string | null };
  subjects: { code: string; name: string }[];
  goals: { id: string; content: string; done: boolean; createdAt: string }[];
  bySubject: {
    subject: { code: string; name: string };
    tier: Tier;
    stats: {
      submissions: number;
      totalTimeMs: number;
      wrongTotal: number;
      wrongMastered: number;
      avgScore: number | null;
    };
    trend: { date: string; avg: number }[];
    badges: { name: string; desc: string; earned: boolean }[];
    radar: { indicators: { name: string; max: number }[]; values: number[] };
  }[];
}

export default function SharePage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");

  useEffect(() => {
    fetch(`/api/share/${params.token}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
        if (j.bySubject?.length) setSubject(j.bySubject[0].subject.code);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [params.token]);

  const current = useMemo(
    () => data?.bySubject.find((b) => b.subject.code === subject) ?? null,
    [data, subject]
  );

  const trendOption = useMemo(() => {
    if (!current) return null;
    return lineOption({
      xLabels: current.trend.map((t) => t.date),
      series: [{ name: "平均掌握度", data: current.trend.map((t) => t.avg) }],
    });
  }, [current]);

  const radarOpt = useMemo(() => {
    if (!current) return null;
    return radarOption({ indicators: current.radar.indicators, values: current.radar.values });
  }, [current]);

  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState icon={Link2} title="链接无效或已失效" hint="请联系老师重新获取分享链接。" />
      </div>
    );
  if (!data || !current)
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <BrandLogo />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{data.student.name} 的成长档案</h1>
          <p className="text-sm text-muted-foreground">
            {data.student.className ?? "未分班"} · 家长只读视图
          </p>
        </div>
        <Badge variant="outline">
          <Eye className="mr-1 h-3 w-3" />
          只读
        </Badge>
        {current && <TierBadge tier={current.tier} />}
      </div>

      <Tabs value={subject} onValueChange={setSubject}>
        <TabsList>
          {data.subjects.map((s) => (
            <TabsTrigger key={s.code} value={s.code}>
              {s.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="提交作业" value={`${current.stats.submissions} 次`} />
        <StatCard
          label="平均得分"
          value={current.stats.avgScore === null ? "—" : pct(current.stats.avgScore)}
        />
        <StatCard
          label="错题 · 已攻克"
          value={`${current.stats.wrongTotal} · ${current.stats.wrongMastered}`}
        />
        <StatCard
          label="已获徽章"
          value={`${current.badges.filter((b) => b.earned).length}/${current.badges.length}`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">掌握度趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {trendOption && current.trend.length > 0 ? (
              <EChart option={trendOption} height={220} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无趋势数据</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">知识图谱</CardTitle>
          </CardHeader>
          <CardContent>
            {radarOpt && current.radar.indicators.length > 0 ? (
              <EChart option={radarOpt} height={220} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无图谱数据</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">徽章（形成性反馈，非排名）</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {current.badges.map((b) => (
            <div
              key={b.name}
              className={`rounded-lg border p-3 text-center ${
                b.earned ? "border-primary/40 bg-primary/5" : "opacity-50"
              }`}
            >
              <p className="text-sm font-medium">{b.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{b.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">学习目标</CardTitle>
        </CardHeader>
        <CardContent>
          {data.goals.length ? (
            <ul className="space-y-2 text-sm">
              {data.goals.map((g) => (
                <li key={g.id} className="flex items-start gap-2">
                  <span className={g.done ? "text-muted-foreground line-through" : ""}>
                    {g.content}
                  </span>
                  {g.done && <Badge variant="outline">已完成</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">暂无目标</p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        累计学习时长 {fmtDuration(current.stats.totalTimeMs)}。本页为只读视图，数据仅用于家校沟通与学习支持；如对数据有疑问或需更正，请联系老师。
      </p>
    </div>
  );
}
