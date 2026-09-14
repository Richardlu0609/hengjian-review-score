# 衡鉴 · 线上项目评审评分系统

## GitHub Pages + Supabase 版本

当前仓库包含面向外部评委的静态部署版本：前端发布到 GitHub Pages，管理员身份和评分数据保存到 Supabase。评委通过 `?judge=专属令牌` 访问，不需要 GitHub 或 ChatGPT 账号。

首次部署只需执行一次：

1. 在 Supabase Dashboard 的 **SQL Editor** 中完整运行 [`supabase/schema.sql`](supabase/schema.sql)。脚本会创建数据表、RLS 权限以及两个受控的评委 RPC。
2. 打开 GitHub 仓库的 **Settings → Pages**，将 Source 选择为 **GitHub Actions**。
3. 等待 `Deploy GitHub Pages` 工作流完成，打开 `https://richardlu0609.github.io/hengjian-review-score/`。
4. 首次进入时创建管理员账号；若 Supabase 开启邮箱验证，请先点击验证邮件，再登录。

GitHub Pages 专用命令：

```powershell
pnpm run typecheck:github
pnpm run build:github
pnpm run preview:github
```

Supabase URL 和 Publishable key 位于 `github-pages/src/config.ts`。Publishable key 是浏览器端标识，数据库安全边界由 `supabase/schema.sql` 中的 RLS 策略和安全函数提供。不要在仓库中加入 Secret key、`service_role` key 或数据库密码。

---

一个可直接部署的线上项目评审 MVP。管理员创建活动、录入项目/评委/指标并分配任务；评委通过独立安全链接保存草稿和提交评分；系统在服务端统一计算成绩、去极值、排名并导出 Excel。

## 已实现功能

- 管理员：活动、项目、评委、评分指标的新增、编辑、删除与状态控制
- 任务：一键将全部项目分配给全部启用评委，可清空并重新分配
- 评委链接：每位评委生成 192 bit 随机 Token，只能看到自己的任务
- 评分：范围、步长、必填项前后端双重校验，500ms 自动保存草稿
- 提交：服务端事务写入；管理员结束或锁定后禁止继续评分
- 统计：完成进度、逐评委明细、平均分、标准差、去最高/最低分、核心指标同分排序
- 管控：成绩锁定、填写原因后解除、评委停用/重置、关键操作审计日志
- 导出：原生生成包含“最终成绩 / 评委详细评分 / 评委完成情况”的多工作表 XLSX
- 响应式界面：桌面管理后台与移动端评委评分页

## 技术架构

- Next.js 16 App Router、React 19、TypeScript、Tailwind CSS、shadcn/ui
- Vinext + Cloudflare Workers（Sites 托管运行时）
- Cloudflare D1 + Drizzle ORM，9 张关系表、外键、唯一约束和查询索引
- Sites / Sign in with ChatGPT 身份头负责管理员认证；首位通过私有站点认证的用户自动成为管理员

规格中的 PostgreSQL/Prisma 在 Sites 的 Workers 运行时中不适合直接 TCP 连接，因此托管版采用 D1/Drizzle。数据仍为真实持久化关系数据，评分写入使用 D1 batch 事务，关键约束与审计均在服务端执行。

## 本地启动

要求 Node.js 22.13+、pnpm 11。

```powershell
pnpm install --frozen-lockfile
pnpm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_elite_satana.sql
pnpm run dev
```

打开 [http://127.0.0.1:5173/signin-with-chatgpt?return_to=/admin](http://127.0.0.1:5173/signin-with-chatgpt?return_to=/admin)。便携式本地预览会使用内置测试身份 `seedy@sites.test`；生产环境使用真实 Sites 身份。

若迁移已经执行过，不要重复执行迁移命令。开发数据库保存在被忽略的 `.wrangler/state` 中。

## 建议操作顺序

1. 进入管理员后台，创建活动。
2. 配置评分指标及核心指标优先级。
3. 添加参评项目和评委。
4. 在“评分进度”中执行“一键全部分配”。
5. 复制每位评委的独立链接，再将活动设为“评分中”。
6. 评委保存草稿、确认提交；后台自动刷新进度和排名。
7. 结束评分、核查结果、锁定成绩并下载 Excel。

## 验证命令

```powershell
pnpm test
pnpm run lint
pnpm run build
```

评分与排序核心逻辑、输入边界和 XLSX 生成器均有自动化测试。数据库迁移位于 `drizzle/0000_elite_satana.sql`。

## 安全说明

- 所有管理 API 都在服务端校验管理员身份，前端隐藏按钮不是权限边界。
- 评委 Token 使用密码学安全随机数生成，不存储密码或密钥到浏览器。
- 评委只能读取分配给自己的项目，不能查看其他评委评分或全局排名。
- 服务端重新校验分值范围、步长、活动时间、评委状态、任务关系和锁定状态。
- 新部署默认保持私有；需要让外部评委访问时，应由站点所有者显式调整 Sites 访问范围。

