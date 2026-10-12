# 线上部署指南

当前仓库已按 **Vercel + Neon（PostgreSQL）** 配置就绪（`prisma/schema.prisma` 为 postgresql provider）。
另附国内云服务器与 Sealos 方案（Dockerfile 已备好）。

## 主路径：Vercel + Neon（免费，含项目名关联的免费域名）

### 1. 创建 Neon 数据库（免费，无需信用卡）

1. 打开 [neon.tech](https://neon.tech) → Sign Up（GitHub 账号一键登录）
2. Create project → 名称如 `int6065` → 区域选 `US East` 或离你近的区域
3. 复制两条连接串（Dashboard → Connect）：
   - **Pooled connection string**（带 `-pooler` 的那个）→ 生产运行时用
   - **Direct connection string** → 执行建表/种子用

### 2. 建表 + 灌入演示数据（在任意一台电脑上执行一次）

```bash
# 在项目目录（把 DIRECT 连接串替换进去）
set DATABASE_URL=<Direct 连接串>
npx prisma db push
npx prisma db seed
```

### 3. 部署到 Vercel（免费）

1. [vercel.com](https://vercel.com) → Sign Up（推荐 GitHub 账号）
2. Add New → Project → Import 选择 `lotsocc1127/INT6065` → Deploy
   （首次部署会因缺环境变量失败，没关系，继续下一步）
3. Project → Settings → Environment Variables 添加：

| Key | Value |
|---|---|
| `DATABASE_URL` | Neon 的 **Pooled** 连接串 |
| `NEXTAUTH_SECRET` | 随机串（`openssl rand -base64 32`） |
| `LLM_PROVIDER` | `deepseek` |
| `DEEPSEEK_API_KEY` | 你的 Key |

4. Redeploy（Deployments → 最新一次 → Redeploy）
5. 打开 https://**int6065.vercel.app** 即为线上版（免费域名 = Vercel 项目名，与仓库名一致）

> 首次部署自动跑 `prisma generate`（Vercel 检测到 Prisma 自动执行），无需改构建命令。
> 正式绑定自有域名：Settings → Domains → 添加（可配合 Cloudflare 提升国内访问）。

### 国内访问注意

- `*.vercel.app` 在大陆部分地区可能访问慢或不稳定；若组员访问不畅，任选其一：
  - **Sealos**（国内可访问，免费试用额度）：仓库内 `Dockerfile` 已备好，上传部署 + 配一个 Postgres 实例即可，可自定义 `int6065.sealos.run` 之类的应用域名；
  - **国内轻量云服务器**：见下方方案 A；
  - 免费二级域名（如 `int6065.us.kg`、`int6065.eu.org`）+ Cloudflare 解析到 Vercel，也可缓解访问问题。

## 方案 A：国内云服务器自托管（约 100–200 元/年）

```bash
# Ubuntu 22.04 + Node 20（或用仓库内 Dockerfile：docker build -t student-growth . && docker run -d -p 3000:3000 --env-file .env student-growth）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs nginx git
git clone https://github.com/lotsocc1127/INT6065.git && cd INT6065
npm ci && npx prisma generate
npx prisma db push && npx prisma db seed   # DATABASE_URL 指向你的 Postgres
npm run build
sudo npm i -g pm2 && pm2 start npm --name student-growth -- start && pm2 save && pm2 startup
# Nginx 反代 + certbot HTTPS 见 README/网络教程
```

## 上线前安全清单

- 密码已 bcrypt 哈希；正式使用前更换 `DEMO_PASSWORD` 或接入真实账号体系
- 更换演示账号、落实未成年人数据知情同意（开发文档第 10 节）
- 中国大陆服务器/域名需 ICP 备案
