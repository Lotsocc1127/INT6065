# CLAUDE.md

AI 学生成长系统（Next.js 14 + Prisma/PostgreSQL + NextAuth + ECharts + llmClient）。
功能与技术说明见 README.md，本文件只记**非显而易见的操作知识**。

## 网络（重要）

- 本机无法直连 github.com / `*.vercel.app`。git 已全局配置代理
  `http://127.0.0.1:6450`（随系统代理客户端；失效时用
  `git config --global http.proxy` 检查，端口以当时代理客户端为准）
- 线上域名国内直连不通，**验证线上部署请走代理**；组员访问方案
  （自定义域名 + Cloudflare / Sealos / 国内服务器）见 DEPLOY.md

## 数据库（Neon 双连接）

- `DATABASE_URL` = Neon **Pooled** 连接串（运行时）；`DIRECT_URL` = Neon
  **Direct** 连接串（`prisma db push` / `db seed` 等 CLI 命令自动使用 Direct）
- 建表/重灌：`npx prisma db push` + `npx prisma db seed`；已有数据时
  seed 会跳过，强制重灌用 `npx tsx prisma/seed.ts --force`
- Windows 上跑 `npx prisma generate` 前**先停 dev server**（query engine
  DLL 被占用会报 EPERM）

## Next.js 构建（Vercel 必查项）

- 任何使用 `getServerSession` / `requireApiUser` 的页面与 API 路由
  **必须**加 `export const dynamic = "force-dynamic"`，否则 Vercel 构建报
  `couldn't be rendered statically because it used 'headers'`
- ECharts 热力图数据项格式为 `[x轴索引, y轴索引, 值]`（本系统 x=知识点、
  y=学生），新增/修改图表时注意坐标顺序与 tooltip 读取顺序一致

## 部署

- Vercel 项目真实域名是 `int-6065.vercel.app`（**不是** int6065.vercel.app）
- push 到 main 自动触发 Vercel 部署（GitHub 集成）；失败的旧部署点
  "Redeploy" 只会重建旧代码，要等自动触发的新部署或手动 Deploy
