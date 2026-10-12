# AI 学生成长系统（AI Student Growth System）

数据驱动、AI 辅助、可多科目切换的学生成长系统，面向初中分层教学。
依据《AI 学生成长系统开发文档》实现：数学（一元一次方程）学科先行，框架支持英语及更多学科。

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

代码与 SQLite 数据（`prisma/dev.db`）均跨平台，但 **`node_modules` 与 `.next` 不可直接拷贝**（含平台相关二进制/缓存）：

```bash
# 推荐用 Git 传输（.gitignore 已排除上述目录）；或打包时排除 node_modules、.next
npm install            # 自动下载对应平台的 Prisma 引擎
npx prisma db push     # 未携带 dev.db 时执行；携带了则跳过
npx prisma db seed     # 同上
npm run dev
```

### 配置 LLM（必填，AI 功能真实调用、无写死结果）

编辑 `.env`：

```env
LLM_PROVIDER="deepseek"            # deepseek | openai | anthropic | zhipu
DEEPSEEK_API_KEY="sk-..."          # 按所选平台填写对应 Key
```

未配置 Key 时：客观题批改不受影响；解答题批改、AI 出题、培养建议、举一反三、苏格拉底辅导会返回明确错误提示。

### 演示账号（密码均为 `123456`）

- 教师：王老师
- 学生（七年级(3)班）：李明、孙悦、张伟、刘洋、陈静、赵磊、周涛、郑楠、王芳、吴桐

## 已实现功能（M0–M9 全覆盖）

- **M0** 项目初始化：NextAuth 角色登录（/login）、llmClient 四平台切换、Prisma（PostgreSQL / 本地可切 SQLite）
- **M1** 种子数据：数学 4 知识点 + 18 题、英语 4 知识点 + 11 题、班级/10 名学生、掌握度历史、1 份演示作业（含 10 份作答与错题）
- **M2** 教师看板：KPI、学生×知识点热力图、知识点柱状图、三层分组名单、共性薄弱点、学生详情抽屉页
- **M3** 数据闭环：布置作业（题库选题 + AI 分层生成）→ 学生在线作答 → 自动批改（客观题即时 / 解答题 AI 按步骤给分）→ 掌握度更新（6:4 加权 + MasteryPoint）→ 看板/图谱实时刷新
- **M4** 学生端：知识图谱雷达图、拓扑学习路径、苏格拉底式辅导（铁律：绝不直接给答案）
- **M5** 错题本（归因/举一反三/标记掌握）、成长档案（趋势/徽章）
- **M6** 治理：数据治理弹窗、目标设定、标签申诉（教师端可见待复核）
- **M7** 英语学科接入：科目切换框架复用同一套代码与 AI 功能
- **M8** 解答题 AI 批改：提交即批改 + 教师端「AI 重批」复核入口
- **M9** 类型检查/构建通过（`npm run typecheck` / `npm run build`）

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
  api/                       # REST API（含 ai/* 五类 LLM 接口）
components/                  # shadcn ui + charts（ECharts）+ app 组件
lib/                         # llm / prompts / mastery / grading / auth / charts
prisma/                      # schema + seed
```

## 生产化注意事项

- 数据库切换 PostgreSQL：改 `prisma/schema.prisma` 的 datasource provider 与 `DATABASE_URL`。
- 密码为演示明文：生产请替换为哈希（bcrypt/argon2）。
- NextAuth：`NEXTAUTH_SECRET` 务必更换；如需数据库会话可接入 Prisma Adapter。
- 治理要求（开发文档第 10 节）已内置为产品行为，生产部署前请落实知情同意与审计流程。
