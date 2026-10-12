"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EChart } from "@/components/charts/echart";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import { radarOption } from "@/lib/charts";
import { pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface KpRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  prereqIds: string[];
  prereqCodes: string[];
}
interface MasteryRow {
  kpId: string;
  kpCode: string;
  value: number;
}

function KnowledgeMap() {
  const searchParams = useSearchParams();
  const subject = searchParams.get("subject") ?? "math";
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [kps, setKps] = useState<KpRow[] | null>(null);
  const [mastery, setMastery] = useState<MasteryRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => setSubjects(Array.isArray(s) ? s : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setKps(null);
    setError("");
    Promise.all([
      fetch(`/api/subjects/${subject}/knowledge-points`).then((r) => r.json()),
      fetch(`/api/mastery?subject=${subject}`).then((r) => r.json()),
    ])
      .then(([k, m]) => {
        setKps(Array.isArray(k) ? k : []);
        setMastery(Array.isArray(m) ? m : []);
      })
      .catch((e) => setError(e.message));
  }, [subject]);

  const masteryById = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of mastery) map.set(m.kpId, m.value);
    return map;
  }, [mastery]);

  const radar = useMemo(() => {
    if (!kps) return null;
    const sorted = [...kps].sort((a, b) => a.code.localeCompare(b.code));
    return radarOption({
      indicators: sorted.map((k) => ({ name: `${k.code} ${k.name}`, max: 1 })),
      values: sorted.map((k) => masteryById.get(k.id) ?? 0),
    });
  }, [kps, masteryById]);

  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SubjectSwitcher subjects={subjects} current={subject} />
      </div>
      {!kps ? <Skeleton className="h-96" /> : null}
      {kps ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>我的知识图谱</CardTitle>
              <CardDescription>雷达图展示各知识点掌握度；你的画像随每次作答实时更新。</CardDescription>
            </CardHeader>
            <CardContent>
              {radar ? <EChart option={radar} height={320} /> : null}
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {kps.map((k) => {
              const v = masteryById.get(k.id) ?? 0;
              return (
                <Card key={k.id}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {k.code} {k.name}
                      <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                        {pct(v)}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {k.prereqCodes.length
                        ? `前置：${k.prereqCodes.join(" → ")}`
                        : "无前置（起点知识点）"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Progress value={v * 100} />
                    {k.description ? (
                      <p className="text-xs text-muted-foreground">{k.description}</p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            我的数据我可见：掌握度只用于帮助我学习，标签可以申诉（见「目标」页）。
          </p>
        </>
      ) : null}
    </div>
  );
}

export default function KnowledgeMapPage() {
  return (
    <Suspense>
      <KnowledgeMap />
    </Suspense>
  );
}
