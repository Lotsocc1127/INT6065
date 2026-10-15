"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { formatStudent } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ClassInfo {
  id: string;
  name: string;
}
interface StudentRow {
  id: string;
  name: string;
  studentNo: string | null;
  goalCount: number;
}

export default function TeacherStudentsPage() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  // 添加学生
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [adding, setAdding] = useState(false);
  // 重置密码 / 移出班级
  const [resetTarget, setResetTarget] = useState<StudentRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StudentRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async (cid: string) => {
    if (!cid) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/teacher/students?classId=${cid}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "加载失败");
      setStudents(Array.isArray(j.students) ? j.students : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((c) => {
        const list: ClassInfo[] = Array.isArray(c) ? c : [];
        setClasses(list);
        if (list.length) {
          setClassId(list[0].id);
          void load(list[0].id);
        }
      })
      .catch(() => {});
  }, [load]);

  async function addStudent() {
    if (!newName.trim()) {
      toast.error("请填写学生姓名");
      return;
    }
    setAdding(true);
    try {
      const r = await fetch("/api/teacher/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          classId,
          password: newPassword.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "添加失败");
      toast.success(`已添加学生 ${formatStudent(newName.trim(), j.studentNo)}`);
      setNewName("");
      setNewPassword("");
      void load(classId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  async function doResetPassword() {
    if (!resetTarget) return;
    if (resetPassword.trim().length < 4 || resetPassword.trim().length > 32) {
      toast.error("密码需 4–32 位");
      return;
    }
    setResetting(true);
    try {
      const r = await fetch(`/api/teacher/students/${resetTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "重置失败");
      toast.success(`已重置 ${formatStudent(resetTarget.name, resetTarget.studentNo)} 的密码`);
      setResetTarget(null);
      setResetPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重置失败");
    } finally {
      setResetting(false);
    }
  }

  async function removeStudent() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const r = await fetch(`/api/teacher/students/${removeTarget.id}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "操作失败");
      toast.success(`已将 ${formatStudent(removeTarget.name, removeTarget.studentNo)} 移出班级（历史记录保留）`);
      setRemoveTarget(null);
      void load(classId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>学生管理</CardTitle>
          <CardDescription>
            管理所选班级的学生账号：添加学生、重置密码、移出班级（移出后历史作答记录保留，学生端不再显示本班内容）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>班级</Label>
            <Select
              value={classId}
              onValueChange={(v) => {
                setClassId(v);
                void load(v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择班级" />
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
          <div className="space-y-2">
            <Label htmlFor="new-name">学生姓名</Label>
            <Input
              id="new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="如：钱小明"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">初始密码（留空则 123456，4–32 位）</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              maxLength={32}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="默认 123456"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={addStudent} disabled={adding} className="gap-1">
              <Plus className="h-4 w-4" />
              {adding ? "添加中…" : "添加学生"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">学生列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !students ? <Skeleton className="h-40" /> : null}
          {students && !loading ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>学号</TableHead>
                  <TableHead>目标数</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.studentNo ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.goalCount} 个目标</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => {
                            setResetTarget(s);
                            setResetPassword("");
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          重置密码
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-destructive"
                          onClick={() => setRemoveTarget(s)}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                          移出班级
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!students.length ? (
                  <TableRow>
                    <TableCell colSpan={4} className="p-0">
                      <EmptyState title="该班级暂无学生" hint="使用上方表单添加学生账号。" />
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {/* 重置密码对话框 */}
      <Dialog open={Boolean(resetTarget)} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              为 {resetTarget ? formatStudent(resetTarget.name, resetTarget.studentNo) : ""} 设置新密码（4–32 位），并请提醒学生妥善保管。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reset-password">新密码</Label>
            <Input
              id="reset-password"
              type="password"
              value={resetPassword}
              maxLength={32}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="4–32 位"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button onClick={doResetPassword} disabled={resetting}>
              {resetting ? "重置中…" : "确认重置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 移出班级确认 */}
      <Dialog open={Boolean(removeTarget)} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移出班级</DialogTitle>
            <DialogDescription>
              确定将 {removeTarget ? formatStudent(removeTarget.name, removeTarget.studentNo) : ""} 移出该班级吗？移出后该生无法再看到本班作业，但其历史作答与掌握度记录会保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={removeStudent} disabled={removing}>
              {removing ? "移出中…" : "确认移出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
