"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, FileText } from "lucide-react";
import { Suspense as ReactSuspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SubjectSwitcher, type SubjectInfo } from "@/components/app/subject-switcher";
import { QuoteCard } from "@/components/app/quote-card";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface AssignmentRow {
  id: string;
  title: string;
  type: string;
  subjectCode: string;
  subjectName: string;
  className: string;
  dueAt: string | null;
  createdAt: string;
  questionCount: number;
  submissionCount: number;
  mySubmissionId: string | null;
}

function TaskCenter() {
  const searchParams = useSearchParams();
  const subject = searchParams.get("subject") ?? "math";
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [list, setList] = useState<AssignmentRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((s) => setSubjects(Array.isArray(s) ? s : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setList(null);
    fetch(`/api/assignments?subject=${subject}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setList(Array.isArray(j) ? j : []);
      })
      .catch((e) => setError(e.message));
  }, [subject]);

  const pending = (list ?? []).filter((a) => !a.mySubmissionId);
  const done = (list ?? []).filter((a) => a.mySubmissionId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SubjectSwitcher subjects={subjects} current={subject} />
        <QuoteCard className="max-w-md flex-1" />
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
      {!list && !error ? <Skeleton className="h-64" /> : null}
      {list ? (
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">待完成（{pending.length}）</TabsTrigger>
            <TabsTrigger value="done">已完成（{done.length}）</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="space-y-3">
            {!pending.length ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  暂无待完成的任务 🎉
                </CardContent>
              </Card>
            ) : null}
            {pending.map((a) => (
              <Card key={a.id}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="h-4 w-4" />
                      {a.title}
                    </CardTitle>
                    <CardDescription>
                      {a.subjectName} · {a.className} · {a.questionCount} 道题
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {a.dueAt ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {fmtDate(a.dueAt)} 截止
                      </span>
                    ) : null}
                    <Button asChild size="sm">
                      <Link href={`/student/assignments/${a.id}`}>去作答</Link>
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </TabsContent>
          <TabsContent value="done" className="space-y-3">
            {!done.length ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">还没有完成的任务。</CardContent>
              </Card>
            ) : null}
            {done.map((a) => (
              <Card key={a.id}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {a.title}
                    </CardTitle>
                    <CardDescription>
                      {a.subjectName} · {a.className} · 已提交
                    </CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/student/assignments/${a.id}`}>查看批改</Link>
                  </Button>
                </CardHeader>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      ) : null}
      {list ? (
        <p className="text-center text-xs text-muted-foreground">
          学习建议：先看「学习路径」，再到「苏格拉底辅导」提问，学完完成作业。
        </p>
      ) : null}
    </div>
  );
}

export default function StudentHomePage() {
  return (
    <ReactSuspense fallback={<Skeleton className="h-64" />}>
      <TaskCenter />
    </ReactSuspense>
  );
}
