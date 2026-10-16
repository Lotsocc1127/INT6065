# CLAUDE.md

智学慧教（数据驱动的教学成长平台；Next.js 14 + Prisma/PostgreSQL + NextAuth + ECharts + llmClient）。
功能与技术说明见 README.md，本文件只记**非显而易见的操作知识**。

## 网络

- **本机（2026-10-14 复测）：github.com 与 `int-6065.vercel.app` 均可直连**，
  且未配置任何 git 代理（`git config --global --get http.proxy` 无输出）。
  此前「无法直连 + 代理 6450」的记录已失效——**别照抄旧结论，先复测**：
  `curl -s -o /dev/null -m 10 -w '%{http_code}\n' https://github.com`
- 若哪天又不通，才需要挂回代理：
  `git config --global http.proxy http://127.0.0.1:<代理客户端端口>`
- 组员（国内网络）访问线上域名的方案（自定义域名 + Cloudflare / Sealos /
  国内服务器）见 DEPLOY.md

## 数据库（Neon 双连接）

- `DATABASE_URL` = Neon **Pooled** 连接串（运行时）；`DIRECT_URL` = Neon
  **Direct** 连接串（`prisma db push` / `db seed` 等 CLI 命令自动使用 Direct）
- 建表/重灌：`npx prisma db push` + `npx prisma db seed`；已有数据时
  seed 会跳过，强制重灌用 `npx tsx prisma/seed.ts --force`
- **开发与生产共用同一个 Neon 库**（`ep-cool-tooth-...`，本地 .env 与
  Vercel 环境变量指向同一库）：任何 `db push` / `seed` 都会直接影响线上；
  **禁止 `seed --force`**（2026-10-14 曾把线上真实测试数据覆盖掉）。
  e2e 也会往这个库写数据（demo 生成/清除、测试作业与目标、分享链接），
  但**跑完自清理**（`scripts/e2e-cleanup.ts` 的 `cleanupRun`，测试成功/失败
  路径都会执行：删本轮作业/目标/分享链接，并从当前值逆推被删提交的 6:4
  加权、再重放剩余提交，恢复该生掌握度与错题本）；残留只可能来自旧版测试
  或清理失败。多台机器/多会话时仍要**错峰跑 e2e**（逆推假设「被删提交都
  晚于剩余提交」，并发交错会引入小误差）。历史残留可用
  `npx tsx --env-file=.env scripts/cleanup-e2e-data.ts` 预览/`--apply` 清理
- **禁止在 Pooled 连接上跑交互式事务**（`$transaction(async tx => ...)`）：
  逐条查询往返慢，超 Prisma 默认 5s 事务超时后报 P2028
  （Transaction not found / already closed）。写操作用**批量事务**
  `$transaction([op1, op2])`（数组形式无 timeout 参数、不受 5s 交互式
  超时限制），依赖数据先在事务外预读（参考 lib/grading.ts 的 processSubmission）
- **Pooled 连接对并发查询敏感**：一次性并发上百条查询会报
  `Can't reach database server`（e2e 实测两连败）。批量回退/多科目快照
  要分批（10 条/批，见 lib/demo.ts clearDemoData）或串行
  （见 app/api/share/[token]/route.ts）
- Windows 上跑 `npx prisma generate` 前**先停 dev server**（query engine
  DLL 被占用会报 EPERM；TaskStop 后可能残留 node 进程占 3000 端口，
  需 `netstat -ano | grep :3000` 找到 PID 后 `taskkill //PID <pid> //F`）

## 学号与账号（第三批）

- **学生有学号** `User.studentNo`（仅 STUDENT，全局递增两位零填充 "01"…，
  `@unique`）。分配走 `lib/student-no.ts` 的 `createStudentWithNo`
  （撞 P2002 重试），**不要**自行 `user.create` 学生（会漏学号）；既有
  数据用 `npx tsx --env-file=.env scripts/backfill-student-no.ts` 回填
  （幂等）。**班级内计数会与全局 @unique 撞车**，学号必须全局递增
- 同班重名靠学号区分：全站学生显示统一用 `formatStudent(name, studentNo)`
  （lib/utils.ts）输出「姓名（学号）」；**按姓名反查学生是 bug**（看板
  分层名单曾因此链错学生），一律按 id
- 密码统一 4–32 字符 + 72 字节上限（`lib/password.ts` 的 `validatePassword`，
  4 条建号/重置路由 + 2 个表单都已接入）；管理员可删除教师
  （`DELETE /api/admin/teachers/[id]`，教师无业务数据行，安全）
- 错因标签按学科生成：`lib/prompts.ts` 的 `gradeSystem(subject)`（数学/
  语文/英语各一套词汇表），seed 语文小测分池同理；**别再用固定的数学
  标签池批改其他学科**

## 演示数据（教师端）

- 一键演示已从管理端移到**教师端看板**（components/app/demo-data-card.tsx），
  API 在 `/api/demo`（TEACHER+ADMIN，原 `/api/admin/demo` 已删）；生成器
  仍写入「前 3 个有学生的班级」真实学生（source="demo" 可整批清除），
  演示作业在教师端作业列表带「演示」徽章
- `generateDemoCycle` 返回 `classNames` 与 `timeline`（5 轮班级平均掌握度），
  生成成功后看板自动刷新并弹出「演示周期回放」动画
  （components/app/demo-replay-dialog.tsx，逐帧 null 占位 + connectNulls 画线）
- e2e 组 14 的「生成前后待复核数」断言只以**非演示来源**数据为基准
  （共享库常残留其他会话的演示数据，生成器会先清掉）

## LLM（多模型路由 F7）

- 候选链配置：`LLM_CHAIN=deepseek,anthropic`（全局）或 `LLM_CHAIN_<TASK>`
  （按任务，TASK 大写，见 lib/llm.ts 的 LlmTask）；单个候选失败
  （网络/4xx-5xx/空内容/JSON 解析失败）自动降级到下一个，全部失败抛聚合错误
- `llmConfigured()` = 候选链非空（不是只看 LLM_PROVIDER 的 Key）；
  本地 .env 的 Key 是空占位符，真实 Key 在 Vercel 环境变量里
- 各 provider 支持 `*_BASE_URL` 环境变量覆盖 baseUrl（中转/代理/本地测试用）

## Next.js 构建（Vercel 必查项）

- 任何使用 `getServerSession` / `requireApiUser` 的页面与 API 路由
  **必须**加 `export const dynamic = "force-dynamic"`，否则 Vercel 构建报
  `couldn't be rendered statically because it used 'headers'`
- ECharts 热力图数据项格式为 `[x轴索引, y轴索引, 值]`（本系统 x=知识点、
  y=学生），新增/修改图表时注意坐标顺序与 tooltip 读取顺序一致
- ECharts **y 轴类目索引 0 渲染在图表底部**（索引向上递增）。要
  「薄弱学生靠下」，学生数组需按平均掌握度**升序**排列（班级看板热力图
  就是这么做的，见 `app/(teacher)/teacher/page.tsx` 的 displayStudents）

## 部署

- Vercel 项目真实域名是 `int-6065.vercel.app`（**不是** int6065.vercel.app）
- push 到 main 自动触发 Vercel 部署（GitHub 集成）；失败的旧部署点
  "Redeploy" 只会重建旧代码，要等自动触发的新部署或手动 Deploy
