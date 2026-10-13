"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, MessageCircleQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import { cn, masteryTextColor, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PathItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  prereqIds: string[];
  mastery: number;
  mastered: boolean;
}

function LearningPath() {
  const searchParams = useSearchParams();
  const subject = searchParams.get("subject") ?? "math";
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [data, setData] = useState<{ items: PathItem[]; next: PathItem | null; done: boolean } | null>(
    null
  );
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
    fetch(`/api/student/path?subject=${subject}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [subject]);

  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SubjectSwitcher subjects={subjects} current={subject} />
      </div>
      {!data ? <Skeleton className="h-96" /> : null}
      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>个性化学习路径</CardTitle>
              <CardDescription>
                按「前置在前」的拓扑顺序为你补全未掌握知识点
                {data.done ? "——恭喜，本学科知识点已全部掌握！🎉" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.items.length ? (
                <p className="text-center text-muted-foreground">
                  {data.done ? "太棒了，继续保持！" : "暂无数据"}
                </p>
              ) : (
                <ol className="relative space-y-0 border-l-2 border-border pl-6">
                  {data.items.map((item, i) => {
                    const isNext = data.next?.id === item.id;
                    return (
                      <li key={item.id} className="relative pb-5">
                        <span
                          className={cn(
                            "absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border-2 bg-background text-[10px] font-semibold",
                            isNext
                              ? "border-blue-500 bg-blue-500 text-white"
                              : "border-border text-muted-foreground"
                          )}
                        >
                          {i + 1}
                        </span>
                        <div
                          className={cn(
                            "rounded-lg border p-3",
                            isNext && "border-blue-500/60 bg-blue-50/60"
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {item.code} {item.name}
                            </span>
                            {item.mastered ? (
                              <Badge className="gap-1 bg-emerald-600">
                                <CheckCircle2 className="h-3 w-3" /> 已掌握
                              </Badge>
                            ) : isNext ? (
                              <Badge className="bg-[#1c5cab]">下一步 · 建议优先</Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-800">待学习</Badge>
                            )}
                            {item.prereqIds.length ? (
                              <span className="text-xs text-muted-foreground">
                                前置：{item.prereqIds.length} 个知识点
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "ml-auto text-sm font-medium tabular-nums",
                                masteryTextColor(item.mastery)
                              )}
                            >
                              {pct(item.mastery)}
                            </span>
                          </div>
                          <div className="mt-2">
                            <Progress value={item.mastery * 100} />
                          </div>
                          {item.description ? (
                            <p className="mt-2 text-xs text-muted-foreground">{item.description}</p>
                          ) : null}
                          {isNext ? (
                            <Button asChild size="sm" variant="outline" className="mt-2 gap-1.5">
                              <Link href={`/student/socrates?kp=${item.code}`}>
                                <MessageCircleQuestion className="h-4 w-4" />
                                去苏格拉底辅导提问
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                        {item.mastered && !isNext ? (
                          <Circle className="absolute -left-[33px] top-3 h-5 w-5 fill-background text-emerald-600" />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground">
            路径随掌握度动态生成：完成后自动推进到下一个未掌握知识点。
          </p>
        </>
      ) : null}
    </div>
  );
}

export default function LearningPathPage() {
  return (
    <Suspense>
      <LearningPath />
    </Suspense>
  );
}
