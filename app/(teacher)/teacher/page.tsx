"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { AlertTriangle, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EChart } from "@/components/charts/echart";
import { StatCard } from "@/components/app/stat-card";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import { TierBadge, TierLegend } from "@/components/app/tier-badge";
import { barOption, heatmapOption } from "@/lib/charts";
import { TIER_META, type Tier } from "@/lib/mastery";
import { pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface DashboardData {
  subject: { code: string; name: string };
  class: { id: string; name: string };
  classes: { id: string; name: string }[];
  kps: { id: string; code: string; name: string; classAvg: number }[];
  students: {
    id: string;
    name: string;
    avg: number;
    tier: Tier;
    values: Record<string, number>;
  }[];
  tiers: Record<Tier, string[]>;
  stats: {
    classAvg: number;
    proficient: number;
    weakKpCodes: string[];
    assignmentCount: number;
    submissionRate: number;
  };
}

function DashboardInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const subject = searchParams.get("subject") ?? "math";
  const [classId, setClassId] = useState<string>("");
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
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
    const params = new URLSearchParams({ subject });
    if (classId) params.set("classId", classId);
    fetch(`/api/teacher/dashboard?${params}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
        setClassId(j.class.id);
      })
      .catch((e) => setError(e.message));
  }, [subject, classId]);

  const heatmap = useMemo(() => {
    if (!data) return null;
    return heatmapOption({
      students: data.students.map((s) => s.name),
      kps: data.kps.map((k) => `${k.code} ${k.name}`),
      data: data.students.flatMap((s, si) =>
        data.kps.map((k, ki) => [ki, si, s.values[k.id] ?? 0] as [number, number, number])
      ),
    });
  }, [data]);

  const kpBar = useMemo(() => {
    if (!data) return null;
    return barOption({
      categories: data.kps.map((k) => `${k.code} ${k.name}`),
      name: "班级平均掌握度",
      data: data.kps.map((k) => k.classAvg),
    });
  }, [data]);

  return (
    <div className="space-y-4">
      {/* 过滤行：科目 + 班级 */}
      <div className="flex flex-wrap items-center gap-3">
        <SubjectSwitcher subjects={subjects} current={subject} />
        {data?.classes?.length ? (
          <Select
            value={classId || data.class.id}
            onValueChange={(v) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("classId", v);
              router.push(`${pathname}?${params.toString()}`);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="选择班级" />
            </SelectTrigger>
            <SelectContent>
              {data.classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {!data && !error ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : null}

      {data ? (
        <>
          {/* KPI 行 */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="班级平均掌握度"
              value={pct(data.stats.classAvg)}
              hint={`${data.subject.name} · ${data.class.name}`}
            />
            <StatCard
              label="达标学生（≥80%）"
              value={`${data.stats.proficient} / ${data.students.length}`}
              hint="可进入拓展探究层"
            />
            <StatCard
              label="共性薄弱知识点"
              value={data.stats.weakKpCodes.length ? data.stats.weakKpCodes.join("、") : "无"}
              hint="班级平均 < 60%"
            />
            <StatCard
              label="作业提交率"
              value={`${data.stats.submissionRate}%`}
              hint={`共 ${data.stats.assignmentCount} 份作业`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* 热力图：学生 × 知识点 */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>学生 × 知识点 掌握度热力图</CardTitle>
                <CardDescription>
                  颜色深浅表示掌握程度；悬停查看具体数值。支持按行比较每位学生的知识缺口。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {heatmap ? <EChart option={heatmap} height={340} /> : null}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {/* 知识点平均 */}
              <Card>
                <CardHeader>
                  <CardTitle>知识点班级平均</CardTitle>
                </CardHeader>
                <CardContent>
                  {kpBar ? <EChart option={kpBar} height={180} /> : null}
                </CardContent>
              </Card>

              {/* 分层名单 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    分层诊断名单
                  </CardTitle>
                  <CardDescription>按平均掌握度动态分层，可流动</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(Object.keys(TIER_META) as Tier[]).map((t) => (
                    <div key={t}>
                      <div className="mb-1 flex items-center justify-between">
                        <TierBadge tier={t} />
                        <span className="text-xs text-muted-foreground">
                          {data.tiers[t].length} 人
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {data.tiers[t].length ? (
                          data.tiers[t].map((name) => {
                            const stu = data.students.find((s) => s.name === name)!;
                            return (
                              <Link key={name} href={`/teacher/students/${stu.id}`}>
                                <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                                  {name}
                                </Badge>
                              </Link>
                            );
                          })
                        ) : (
                          <span className="text-xs text-muted-foreground">暂无</span>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* 共性薄弱点提示 */}
          {data.stats.weakKpCodes.length ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="font-medium">共性薄弱点：</span>
                {data.kps
                  .filter((k) => data.stats.weakKpCodes.includes(k.code))
                  .map((k) => (
                    <Badge key={k.id} variant="secondary">
                      {k.code} {k.name}（{pct(k.classAvg)}）
                    </Badge>
                  ))}
                <span className="text-muted-foreground">
                  建议针对这些知识点布置分层作业或组织讲评。
                </span>
              </CardContent>
            </Card>
          ) : null}

          <TierLegend />
        </>
      ) : null}
    </div>
  );
}

export default function TeacherDashboardPage() {
  return (
    <Suspense>
      <DashboardInner />
    </Suspense>
  );
}
