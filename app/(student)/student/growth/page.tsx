"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Award, Clock, FileCheck2, ListX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EChart } from "@/components/charts/echart";
import { StatCard } from "@/components/app/stat-card";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import { lineOption } from "@/lib/charts";
import { cn, fmtDuration, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface GrowthData {
  stats: {
    submissions: number;
    totalTimeMs: number;
    wrongTotal: number;
    wrongMastered: number;
    avgScore: number | null;
  };
  trend: { date: string; avg: number }[];
  kpTrend: { code: string; name: string; series: { at: string; value: number }[] }[];
  badges: { name: string; desc: string; earned: boolean }[];
}

function GrowthArchive() {
  const searchParams = useSearchParams();
  const subject = searchParams.get("subject") ?? "math";
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [data, setData] = useState<GrowthData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => setSubjects(Array.isArray(s) ? s : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setData(null);
    setError("");
    fetch(`/api/growth?subject=${subject}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [subject]);

  const trendOption = useMemo(() => {
    if (!data?.trend?.length) return null;
    return lineOption({
      xLabels: data.trend.map((t) => t.date),
      series: [{ name: "平均掌握度", data: data.trend.map((t) => t.avg) }],
      smooth: true,
    });
  }, [data]);

  const kpTrendOption = useMemo(() => {
    if (!data?.kpTrend?.length) return null;
    const times = [...new Set(data.kpTrend.flatMap((k) => k.series.map((s) => s.at)))].sort();
    return lineOption({
      xLabels: times.map((t) => {
        const d = new Date(t);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      }),
      series: data.kpTrend.map((k) => {
        const byTime = new Map(k.series.map((s) => [s.at, s.value]));
        return { name: `${k.code} ${k.name}`, data: times.map((t) => byTime.get(t) ?? null) };
      }),
    });
  }, [data]);

  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SubjectSwitcher subjects={subjects} current={subject} />
      </div>
      {!data && !error ? <Skeleton className="h-96" /> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="提交作业"
              value={`${data.stats.submissions} 次`}
              hint={data.stats.avgScore != null ? `平均得分 ${pct(data.stats.avgScore)}` : undefined}
            />
            <StatCard label="学习时长" value={fmtDuration(data.stats.totalTimeMs)} />
            <StatCard
              label="错题"
              value={`${data.stats.wrongTotal} 道`}
              hint={`已攻克 ${data.stats.wrongMastered} 道`}
            />
            <StatCard
              label="获得徽章"
              value={`${data.badges.filter((b) => b.earned).length} / ${data.badges.length}`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>掌握度成长曲线</CardTitle>
              <CardDescription>按天聚合的平均掌握度变化</CardDescription>
            </CardHeader>
            <CardContent>
              {trendOption ? <EChart option={trendOption} height={240} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>各知识点轨迹</CardTitle>
            </CardHeader>
            <CardContent>
              {kpTrendOption ? <EChart option={kpTrendOption} height={260} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>成长徽章</CardTitle>
              <CardDescription>徽章是给自己的鼓励，不做排名比较</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {data.badges.map((b) => (
                <div
                  key={b.name}
                  className={cn(
                    "rounded-lg border p-3 text-center",
                    b.earned ? "border-emerald-300 bg-emerald-50/60" : "opacity-60"
                  )}
                >
                  <Award
                    className={cn(
                      "mx-auto mb-1 h-8 w-8",
                      b.earned ? "text-emerald-600" : "text-muted-foreground"
                    )}
                  />
                  <div className="text-sm font-medium">{b.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{b.desc}</div>
                  <div className="mt-1 text-xs font-medium">{b.earned ? "已获得 🎉" : "未获得"}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileCheck2 className="h-3.5 w-3.5" /> 提交即记录
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> 时长仅统计作答
            </span>
            <span className="flex items-center gap-1">
              <ListX className="h-3.5 w-3.5" /> 错题可申诉
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function GrowthPage() {
  return (
    <Suspense>
      <GrowthArchive />
    </Suspense>
  );
}
