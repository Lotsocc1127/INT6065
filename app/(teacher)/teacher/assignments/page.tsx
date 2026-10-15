"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface AssignmentRow {
  id: string;
  title: string;
  type: string;
  source: string | null;
  subjectCode: string;
  subjectName: string;
  className: string;
  dueAt: string | null;
  createdAt: string;
  questionCount: number;
  submissionCount: number;
  tiered: boolean;
}

export default function TeacherAssignmentsPage() {
  const [list, setList] = useState<AssignmentRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/assignments")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setList(Array.isArray(j) ? j : []);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>作业管理</CardTitle>
        <Button asChild size="sm" className="gap-1">
          <Link href="/teacher/assignments/new">
            <Plus className="h-4 w-4" />
            布置作业
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {error ? <p className="text-destructive">{error}</p> : null}
        {!list && !error ? <Skeleton className="h-64" /> : null}
        {list ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>科目</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>班级</TableHead>
                <TableHead>截止</TableHead>
                <TableHead className="text-right">题目</TableHead>
                <TableHead className="text-right">已交</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell>{a.subjectName}</TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <Badge variant={a.type === "QUIZ" ? "secondary" : "outline"}>
                        {a.type === "QUIZ" ? "测验" : "作业"}
                      </Badge>
                      {a.tiered ? (
                        <Badge className="bg-amber-100 text-amber-800">分层</Badge>
                      ) : null}
                      {a.source === "demo" ? (
                        <Badge className="bg-violet-100 text-violet-800">演示</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{a.className}</TableCell>
                  <TableCell>{a.dueAt ? fmtDate(a.dueAt) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.questionCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.submissionCount}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm" className="gap-1.5">
                      <Link href={`/teacher/assignments/${a.id}`}>
                        <Eye className="h-3.5 w-3.5" />
                        查看批改
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!list.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState title="还没有作业" hint="点击右上角「布置作业」，从题库选题或用 AI 分层出题。" />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
