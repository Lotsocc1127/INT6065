"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, School, Trash2, UserCog } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface TeacherRow {
  id: string;
  name: string;
}
interface ClassRow {
  id: string;
  name: string;
  studentCount: number;
}

export default function AdminPage() {
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  // 添加教师
  const [tName, setTName] = useState("");
  const [tPassword, setTPassword] = useState("");
  const [adding, setAdding] = useState(false);
  // 重置教师密码
  const [resetTarget, setResetTarget] = useState<TeacherRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  // 删除教师
  const [deleteTarget, setDeleteTarget] = useState<TeacherRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 新建班级
  const [cName, setCName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadTeachers = useCallback(async () => {
    fetch("/api/admin/teachers")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setTeachers(Array.isArray(j) ? j : []);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载失败"));
  }, []);

  const loadClasses = useCallback(async () => {
    fetch("/api/classes")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "加载失败");
        setClasses(Array.isArray(j) ? j : []);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载失败"));
  }, []);

  useEffect(() => {
    void loadTeachers();
    void loadClasses();
  }, [loadTeachers, loadClasses]);

  async function addTeacher() {
    if (!tName.trim()) {
      toast.error("请填写教师姓名");
      return;
    }
    setAdding(true);
    try {
      const r = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tName.trim(), password: tPassword.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "添加失败");
      toast.success(`已添加教师 ${tName.trim()}`);
      setTName("");
      setTPassword("");
      void loadTeachers();
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
      const r = await fetch(`/api/admin/teachers/${resetTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "重置失败");
      toast.success(`已重置 ${resetTarget.name} 的密码`);
      setResetTarget(null);
      setResetPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重置失败");
    } finally {
      setResetting(false);
    }
  }

  async function deleteTeacher() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/admin/teachers/${deleteTarget.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "删除失败");
      toast.success(`已删除教师 ${deleteTarget.name}`);
      setDeleteTarget(null);
      void loadTeachers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function createClass() {
    if (!cName.trim()) {
      toast.error("请填写班级名称");
      return;
    }
    setCreating(true);
    try {
      const r = await fetch("/api/admin/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cName.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "创建失败");
      toast.success(`已创建班级 ${cName.trim()}`);
      setCName("");
      void loadClasses();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            教师账号管理
          </CardTitle>
          <CardDescription>创建教师账号、重置教师密码。教师可自行管理各班学生账号（学生管理页）。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="teacher-name">教师姓名</Label>
            <Input
              id="teacher-name"
              value={tName}
              onChange={(e) => setTName(e.target.value)}
              placeholder="如：李老师"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="teacher-password">初始密码（留空则 123456，4–32 位）</Label>
            <Input
              id="teacher-password"
              type="password"
              value={tPassword}
              maxLength={32}
              onChange={(e) => setTPassword(e.target.value)}
              placeholder="默认 123456"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={addTeacher} disabled={adding} className="gap-1">
              <Plus className="h-4 w-4" />
              {adding ? "添加中…" : "添加教师"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">教师列表</CardTitle>
        </CardHeader>
        <CardContent>
          {!teachers ? <Skeleton className="h-32" /> : null}
          {teachers ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teachers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => {
                            setResetTarget(t);
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
                          onClick={() => setDeleteTarget(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!teachers.length ? (
                  <TableRow>
                    <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                      暂无教师账号
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <School className="h-5 w-5" />
            班级管理
          </CardTitle>
          <CardDescription>新建班级后，教师即可在「学生管理」中向该班级添加学生。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="class-name">班级名称</Label>
            <Input
              id="class-name"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              placeholder="如：七年级(2)班"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={createClass} disabled={creating} className="gap-1">
              <Plus className="h-4 w-4" />
              {creating ? "创建中…" : "新建班级"}
            </Button>
          </div>
          <div className="space-y-2 md:col-span-3">
            {!classes ? <Skeleton className="h-16" /> : null}
            {classes ? (
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => (
                  <Badge key={c.id} variant="secondary" className="text-sm">
                    {c.name}（{c.studentCount} 名学生）
                  </Badge>
                ))}
                {!classes.length ? (
                  <p className="text-sm text-muted-foreground">暂无班级，使用上方表单创建。</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* 删除教师确认 */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除教师</DialogTitle>
            <DialogDescription>
              确定删除教师 {deleteTarget?.name} 吗？该操作不可撤销。若该教师名下存在业务数据将无法删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={deleteTeacher} disabled={deleting}>
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码对话框 */}
      <Dialog open={Boolean(resetTarget)} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置教师密码</DialogTitle>
            <DialogDescription>
              为 {resetTarget?.name} 设置新密码（4–32 位），并请提醒其妥善保管。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-reset-password">新密码</Label>
            <Input
              id="admin-reset-password"
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
    </div>
  );
}
