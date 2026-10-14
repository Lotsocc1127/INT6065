# 智学慧教（Zhixue Huijiao · 数据驱动的教学成长平台）

数据驱动、AI 辅助、可多科目切换的教学成长平台，面向初中分层教学。
依据开发文档实现：数学、英语、语文三科知识图谱（人教版七年级上册），框架支持更多学科。

## 技术栈

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Prisma（SQLite 本地 / PostgreSQL 生产） · ECharts · NextAuth.js · llmClient（OpenAI / Anthropic / DeepSeek / 智谱，环境变量切换）

## 快速开始

数据库为 PostgreSQL（推荐 [Neon](https://neon.tech) 免费实例，本地开发与线上共用同一数据库）：

```bash
npm install
# 把 Neon 连接串填入 .env 的 DATABASE_URL（见 .env 内注释）
npx prisma db push          # 建表
npx prisma db seed          # 灌入演示数据（重灌：npx tsx prisma/seed.ts --force）
npm run dev                 # http://localhost:3000
```

> 历史上用过的 SQLite（`prisma/dev.db`）已弃用，可从 Neon 重新 seed 生成演示数据；如需本地单机 SQLite，把 `prisma/schema.prisma` 的 datasource provider 改回 `sqlite` 并 `npx prisma db push` 即可（两套 provider 的业务代码完全一致）。

### 在其他电脑上运行（Mac / Linux）

代码跨平台；`node_modules` 与 `.next` 不可直接拷贝（含平台相关二进制/缓存），用 Git 传输即可（.gitignore 已排除）。数据库在 Neon 云端，无需携带数据文件：

```bash
git clone https://github.com/Lotsocc1127/INT6065.git
cd INT6065
npm install
# 把 .env 从原机器拷来（或按 .env.example 填写：Neon 双连接串 + LLM Key，见上方「数据库」节）
npx prisma generate   # Windows 上此步需先停 dev server（DLL 占用）；macOS/Linux 无此限制
npm run dev
```

验证：浏览器打开 `/login` 能登录即数据库连通；可再跑 `npx tsx scripts/browser-check.ts` 做两端页面只读点检。

### 配置 LLM（必填，AI 功能真实调用、无写死结果）

编辑 `.env`：

```env
LLM_PROVIDER="deepseek"            # deepseek | openai | anthropic | zhipu
DEEPSEEK_API_KEY="sk-..."          # 按所选平台填写对应 Key
```

未配置 Key 时：客观题批改不受影响；解答题批改、AI 出题、培养建议、举一反三、苏格拉底辅导会返回明确错误提示。

### 演示账号（密码均为 `123456`）

- 管理员：管理员（管理教师账号与班级）
- 教师：王老师、李老师、张老师（可管理班级学生账号）
- 学生（三个班各 30 人）：七年级(3)班演示名单含李明、孙悦、张伟、刘洋、陈静、赵磊、周涛、郑楠、王芳、吴桐等

## 已实现功能（M0–M9 全覆盖）

- **M0** 项目初始化：NextAuth 角色登录（/login）、llmClient 四平台切换、Prisma（PostgreSQL / 本地可切 SQLite）
- **M1** 种子数据：数学 8 知识点 + 32 题、英语 8 知识点 + 28 题、语文 8 知识点 + 28 题（人教版七年级上册）、3 个班级各 30 人、3 名教师账号、掌握度历史、6 份演示作业（每班数学作业 + 语文小测，含全班作答与错题）
- **M2** 教师看板：KPI、学生×知识点热力图、知识点柱状图、三层分组名单、共性薄弱点、学生详情抽屉页
- **M3** 数据闭环：布置作业（题库选题 + AI 分层生成）→ 学生在线作答 → 自动批改（客观题即时 / 解答题 AI 按步骤给分）→ 掌握度更新（6:4 加权 + MasteryPoint）→ 看板/图谱实时刷新
- **M4** 学生端：知识图谱雷达图、拓扑学习路径、苏格拉底式辅导（铁律：绝不直接给答案）
- **M5** 错题本（归因/举一反三/标记掌握）、成长档案（趋势/徽章）
- **M6** 治理：数据治理弹窗、目标设定、标签申诉（教师端可见待复核）
- **M7** 多学科接入（数学/英语/语文）：科目切换框架复用同一套代码与 AI 功能
- **M8** 解答题 AI 批改：提交即批改 + 教师端「AI 重批」复核入口
- **M9** 类型检查/构建通过（`npm run typecheck` / `npm run build`）
- **M10** AI 备课助手：基于班级学情（分层/薄弱知识点/错误标签/提交率）生成可编辑教案
- **M11** 账号管理（两级分工）：管理员创建/重置教师账号、新建班级；教师管理本班学生（添加/重置密码/移出班级）

## 关键设计

- **数据驱动**：新增学科 = 新增一套知识图谱/题库数据，框架零改动；画像维度来自数据库，前端不写死。
- **掌握度算法**（lib/mastery.ts）：简化 BKT 加权（旧:新 = 6:4），分层阈值 0.5 / 0.8，学习路径拓扑补前置；已预留标准 BKT 升级路径。
- **AI 全链路**（lib/llm.ts + lib/prompts.ts）：统一 llmChat/llmJson 封装，结构化 JSON 容错解析；苏格拉底辅导系统提示词完整实现铁律。
- **治理内嵌**：AI 输出全部可编辑/否决（出题→审校→采纳；批改→重批；建议→教师决策），分层动态可流动，标签可申诉。
- **图表规范**：颜色来自经校验的调色板（连续色阶蓝 100→700、序列按槽位固定分配），图例/表格兜底，标签用文本色。

## 目录结构

```
app/
  (teacher)/teacher/         # 教师端：看板 / 作业 / 学生详情
  (student)/student/         # 学生端：任务 / 图谱 / 路径 / 辅导 / 错题本 / 成长 / 目标
  api/                       # REST API（含 ai/* 六类 LLM 接口）
components/                  # shadcn ui + charts（ECharts）+ app 组件
lib/                         # llm / prompts / mastery / grading / auth / charts
prisma/                      # schema + seed
```

## 生产化注意事项

- 数据库切换 PostgreSQL：改 `prisma/schema.prisma` 的 datasource provider 与 `DATABASE_URL`。
- 密码为演示明文：生产请替换为哈希（bcrypt/argon2）。
- NextAuth：`NEXTAUTH_SECRET` 务必更换；如需数据库会话可接入 Prisma Adapter。
- 治理要求（开发文档第 10 节）已内置为产品行为，生产部署前请落实知情同意与审计流程。
