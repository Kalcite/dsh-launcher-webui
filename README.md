# dsh-launcher — DeepSeek Harness 便携启动器套件

现代化 Web 仪表盘 + 零依赖 Node 后端，用于管理本机 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）开发环境。**服务器启停 / 状态探活 / 实时日志 / 一键部署 dsh / 更新管理（GitHub Releases 同步 + 版本选择）/ 客户端构建修复 / 环境信息 / 一键打开 Web UI / 仓库 / VSCode**。

## 项目信息

| 项 | 说明 |
|---|---|
| 前端 | React 18 + TypeScript + Vite 6（深色玻璃拟态 UI，零 UI 框架依赖） |
| 后端 | 原生 Node（仅内置模块，**零运行时依赖**），`server\index.mjs` 单文件 |
| 实时推送 | SSE（`/api/events`）：日志 / 状态 / 部署 / 更新事件 |
| 工具链 | 套件内便携 Node v24.18.0 + pnpm 11.7、便携 Python 3.12.10 + venv（pyyaml） |
| 设计原则 | **套件自包含可整体打包移动**；**dsh 本体不打包**（仓库约 1.6GB），放独立目录由启动器选择/默认调用 |

### 目录结构

```
J:\dsh-launcher\                 ← 套件根（运行时约 172MB，可整体压缩分发）
├── .runtime\
│   ├── node\       便携 Node v24.18.0 + pnpm 11.7（npm/npx/pn 全套 shim）
│   ├── python\     便携 Python 3.12.10（nuget 官方包，约 14MB）
│   └── venv\       虚拟环境（pyyaml 6.0.3，供 tools\ 工具使用）
├── server\index.mjs   零依赖 Node 后端（启停/部署/更新/修复/SSE/静态）
├── src\ + dist\       React 启动器 UI（dist\ 随套件分发，开箱即用）
├── tools\plugin.py    插件管理（Python + pyyaml 编辑 cordis.patch.yml）
├── tools\launcher_boot.py   启动引导（全部启动/停止/收尾逻辑，.cmd 仅调用）
├── launcher.cmd       双击入口：调用 launcher_boot.py 启动后端 + 自动开浏览器
├── launcher-stop.cmd  停止后端（调用 launcher_boot.py --stop，支持 --port N）
├── setup.cmd          新机器引导：便携 Node/Python/venv + 构建前端
├── config.json        dshRoot 指向独立目录（相对路径可用）
└── dsh-test\          （可选）独立测试沙盒，已 gitignore
```

## 功能总览

| 页面 | 功能 |
|---|---|
| **概览** | 服务器启停/重启 + HTTP 探活 + PID/日志大小；环境信息（node/pnpm/git/便携 Node/dshRoot）；数据目录 DSH_HOME 配置（支持**文件夹选择器**）；一键打开 Web UI / 仓库目录 / VSCode；实时日志面板（过滤/跟随/清空视图） |
| **管理 dsh** | dsh 本体目录部署/切换/检查（一键部署 clone+install+build、**文件夹选择器**、切换 dshRoot） |
| **插件管理** | 已安装插件（含本体自带，本体不可修改）+ 禁用/启用/卸载；npm @deepseek-ai 搜索安装（精确/模糊）；特殊插件 dsh-routing-suite / dsh-better-sidebar |
| **事件管理器** | webui 与 dsh 事件记录（正常不标注、警告黄、错误红）；日志查看 + **打开日志文件夹**；**致命错误弹窗**（查看日志 / 尝试恢复） |
| **更新 dsh** | 检查更新（GitHub Releases 同步更新内容）；版本选择升级（默认最新）；客户端 bundle 健康检测与一键修复 |
| **设置** | 基本参数（dsh 端口 / WebUI 端口 / profile，下次启动生效）；**检查启动器更新**（分步更新不中断当前进程，重启完成剩余更新） |

## 快速开始

```sh
setup.cmd           # 新机器引导：装便携 Node/Python/venv + 构建前端（已就绪则秒过）
launcher.cmd        # 双击：启动后端 + 自动打开浏览器 http://127.0.0.1:5177
launcher.cmd --port 5190 --web-port 3080   # 指定启动器端口 / dsh 端口
launcher-stop.cmd [--port N]               # 停止后端
```

VSCode 轻度开发：`code J:\dsh-launcher`，然后 `pnpm dev`（Vite HMR 5178 + 后端 5177）或 `pnpm build && pnpm start`。

## 一键部署 dsh（「部署 dsh」页）

1. 输入目标目录（相对套件根或绝对路径，如 `../dsh` 或 `D:/dsh`）
2. 点 **一键部署到此目录** → 后台执行 `git clone --depth 1` → `pnpm install` → `pnpm run build`（进度经 SSE 实时显示在日志面板）
3. 部署完成自动把 `dshRoot` 切换到新目录，点「启动」即用新版本

已有目录可**检查状态**（git 分支/提交/版本/依赖/构建产物/部署就绪）或**切换到此目录**（不部署，仅切换 dshRoot）。

## 插件管理（「插件管理」页）

- **已安装插件**：列出 profile 已装 bundle 与本体自带插件（`dsh.profile.bundles` + `cordis.patch.yml` 禁用标记）
  - **本体自带**（dsh 仓库 workspace 提供，如 `@deepseek-ai/dsh-base`）标记"本体自带 · 不可修改"，禁用/卸载被后端拒绝
  - 用户安装插件支持**禁用 / 启用 / 卸载**（禁用 = 编辑 `cordis.patch.yml`，重启生效；卸载 = `dsh plugin remove`）
- **搜索安装**：npm `@deepseek-ai/` 系列插件（候选池 + 本地过滤）
  - **精确搜索**：输入完整包名（如 `dsh-bash-sandbox`）→ 完全匹配 `@deepseek-ai/dsh-bash-sandbox`
  - **模糊搜索**：输入关键词（如 `sandbox`）→ 名称/描述包含的全部返回（`dsh-bash-sandbox`、`dsh-pwsh-sandbox`、`dsh-sandbox-local`…），精确命中排最前
  - 一键 `dsh plugin add` 安装；自动处理 pnpm 构建脚本拦截（写入 profile `pnpm-workspace.yaml` 的 `allowBuilds`（node-pty/esbuild）并失败重试）
- **特殊插件**：
  - **dsh-routing-suite**（[GitHub](https://github.com/yjh051108/dsh-routing-suite)）：注入器 + 路由预设，安装自动完成二次修复（Release 预构建注入器 → 装配 bundles → 子模块克隆 → 预设平铺 → preset.yml 引号修复）
  - **dsh-better-sidebar**（[GitHub](https://github.com/omdsh-dev/DSH-better-sidebar)）：VSCode 风格侧边栏工作台，npm 发布、独立脚本安装、**无需修补**

## 更新 dsh（「更新 dsh」页）

### 检查更新

- 自动/手动调用 `GET /api/update/check`：
  - 本地当前信息：分支、提交、最近版本标签、package.json 版本
  - **同步 GitHub Releases**（最近 15 个）：tag、名称、发布日期、pre-release 标记、**更新内容（release body，可展开查看）**
  - **客户端 bundle 健康**：扫描所有声明 `dsh.client` 的包，核对 `lib/client.js` 是否存在

### 版本选择升级（默认最新）

- 版本列表按发布时间倒序，单选（默认第一项 = 最新），当前版本带绿色徽章且不可重复升级
- **更新到指定版本**：`git fetch tag` → `checkout -B master <tag> -f` → `pnpm install` → `pnpm run build`
- **更新到最新 master**：`git pull --ff-only`（失败回退 fetch + checkout），解除固定版本

### 更新流程的工程保护（针对版本切换的残留问题）

| 保护 | 说明 |
|---|---|
| **自动停服** | 更新前若检测到本启动器管理的 dsh 服务器在运行 → 自动停止后再更新；端口被**非启动器进程**占用 → 拒绝并提示先停止 |
| **强制全量重建** | 版本切换后执行 `pnpm run clean`（清除全部 `lib/` 与 tsbuildinfo 增量缓存）→ 全量 `pnpm run build`，杜绝旧版本产物/增量残留 |
| **客户端 bundle 校验** | 构建后自动扫描校验；缺失时日志明确列出缺失包与路径，并提示点击「修复客户端构建」 |

## 客户端构建修复（bundle script failed to load）

### 问题现象

老版本更新到新版本后，dsh 页面报错：

```
Failed to load plugins
failed to import loader entry 8e3ad609 (@deepseek-ai/dsh-typert-registry):
client-modules: bundle script /plugins/@deepseek-ai/dsh-typert-registry/client.js?rev=f41d56e0b747 failed to load
```

### 根因（已实证复现）

1. dsh 的 client-modules 在服务器启动时按 **client.js 文件内容哈希** 生成 `rev`，浏览器按该 URL 加载客户端 bundle；
2. 若对应 `lib/client.js` **缺失或正被重建** → 请求 404 → 浏览器端 script error → 上述报错；
3. 触发场景：**更新时服务器仍在运行**（git checkout / pnpm install 在运行中的服务器眼皮下替换、删除 `lib/` 产物）；或**版本切换后增量构建残留**（旧版本 tsbuildinfo 让 `tsc -b` 跳过重建，部分包 client.js 缺失/过期）。

> 复现实验：启动服务器 → 删除 `packages/typert/registry/lib/client.js` → 该 bundle URL 立即 404，与报错机制完全一致。

### 解决方案

- **一键修复**：更新页点「修复客户端构建」（`POST /api/update/repair`）→ 自动停服 → `pnpm run clean` + `pnpm install` + 全量 `pnpm run build` → 健康校验，全程 SSE 进度
- **更新页健康条**：`GET /api/update/check` 返回 `clientBundles` 健康；缺失即红条 + 修复按钮
- **手动**（不用 UI 时）：在 dsh 仓库目录执行

  ```sh
  pnpm run clean && pnpm install && pnpm run build
  ```

- 修复完成后：**重启 dsh 服务器**；浏览器若显示旧页面请**硬刷新（Ctrl+Shift+R）**（rev 为缓存戳，新页面自带新 rev）

## 配置（config.json）

| 键 | 默认 | 说明 |
|---|---|---|
| `dshRoot` | `../deepseek_harness` | dsh 仓库目录（相对套件根解析，支持绝对路径） |
| `dshHome` | `null` | **dsh 用户数据根 DSH_HOME**：null = 默认 `~/.dsh`；可指向项目目录（如 `./.dsh` 相对 dshRoot 解析）或任意绝对路径；支持 `~` 展开 |
| `webPort` | `3080` | dsh Web UI 端口（启停目标） |
| `launcherPort` | `5177` | 启动器自身端口 |
| `profile` | `null` | 启动 dsh 的 profile（null = web） |
| `standbyRoot` | `.dsh_temp/dsh` | 备用 dsh 本体目录（相对套件根或绝对路径） |
| `standbyHome` | `.dsh_temp/.dsh` | 备用端独立 DSH_HOME（相对套件根或绝对路径，支持 `~`） |
| `standbyWebPort` | `3090` | 备用 dsh Web UI 端口（固定默认，可改；重启启动器生效） |
| `standbyTag` | `dsh-v0.1.3-alpha.1` | 备用端固定版本（最稳定组合登记值） |
| `openBrowser` | `false` | 后端启动时自动开浏览器 |

优先级：`config.json` < 环境变量（`DSH_ROOT` / `DSH_WEB_PORT` / `DSH_LAUNCHER_PORT` / `DSH_PROFILE` / `DSH_OPEN_BROWSER`）< CLI 参数（`--dsh-root` / `--dsh-home` / `--web-port` / `--port` / `--profile` / `--open`）。UI 内「切换 dshRoot」「数据目录 DSH_HOME」与部署/更新完成会自动持久化配置。

## 数据目录 DSH_HOME（放项目里还是用户文件夹？）

dsh 的所有用户数据（**profile / 插件 / 会话 / 凭据 / 预设 / 附件 / 匿名 ID** 等）集中在一个根下，解析优先级（dsh 官方 `home-paths` 实现）：

```
显式配置路径 > $DSH_HOME 环境变量 > 默认 ~/.dsh
```

- **默认**：不设置 `dshHome` → dsh 用 `C:\Users\<用户>\.dsh`（用户文件夹）
- **放项目目录**：启动器「概览 → 数据目录 DSH_HOME」输入 `./.dsh`（相对 dshRoot 解析，如 `J:\deepseek_harness\.dsh`）或任意绝对路径 → 保存 → 重启 dsh 服务器
  - profile / 插件 / 会话等全部跟随所选目录，与用户文件夹完全隔离（适合多套环境互不干扰、随项目整体迁移）
  - dsh 会在该目录自动初始化（profiles、storages 等）
- 切换后**必须重启 dsh 服务器**生效；`tools\plugin.cmd` 同样跟随（读 config.json 的 dshHome）
- 注：DSH_HOME 只作用于服务端，不会泄漏到浏览器端（dsh 官方明确剔除）

## 备用服务器（.dsh_temp）——固定版本 + 独立 DSH_HOME

> 主端（`dshRoot`）是用户自选目录（如 `G:\dsh`，可切换/自定义）；**备用端**固定版本、独立用户目录，二者完全隔离。

### 用途

- **版本守护**：备用端固定在最稳定组合登记版本 **dsh `dsh-v0.1.3-alpha.1`（d347e70）**，不随主端/启动器更新。主端升级或插件事故后无法启动时，启动备用端（默认端口 **3090**）→ 打开备用 UI 新建会话 → 让智能体按内置 `dsh-operations` skill 诊断并修复主端（vibecoding 式自愈）。
- **测试端**：`.dsh_temp/upstream/` 为 dsh-routing-suite 上游对照 clone；预设改动先用 `compat-test/run.mjs`（离线回归）验证。

### 目录与数据

```
G:\dsh-launcher\.dsh_temp\        ← 整体 gitignore，不随启动器更新分发
├── dsh\                          备用 dsh 本体（固定 tag clone + node_modules/dist）
├── .dsh\                         备用端独立 DSH_HOME（profiles/plugins/.agent-presets/skills）
│   ├── plugins\dsh-super-injector + profiles\web（router 注入器装配）
│   ├── .agent-presets\router-standard|router-spec（含 0.1.3 兼容层，v0.7.7+ 安装逻辑）
│   ├── skills\dsh-operations\SKILL.md（运维 skill，user-dsh 根自动加载）
│   └── （better-sidebar@0.18.0 随 profile 安装）
├── upstream\                      routing-suite 对照 clone（可删）
└── compat-test\                   离线回归测试（可删）
```

用户目录初始化只装 **router（注入器+预设）与 better-sidebar**，其余一律不带——备用端保持干净、可预测。

### 使用（UI 或 API）

| 动作 | UI（管理 dsh → 备用服务器，默认折叠） | API |
|---|---|---|
| 查看状态 | 卡片摘要（随 3s 轮询） | `GET /api/standby/status`（完整） |
| 部署（自动检测目录与文件 → clone 固定 tag 或同步 → install → build → build:web） | 折叠区「部署备用端（自动检测目录）」/「重新部署/同步」 | `POST /api/standby/bootstrap` |
| 初始化用户目录（router+sidebar+skill） | 「初始化用户目录」 | `POST /api/standby/provision` |
| 启动 / 停止 / 重启（独立端口 3090、`DSH_HOME`=备用 .dsh） | 折叠区按钮 | `POST /api/standby/start|stop|restart` |
| 打开 备用 UI / 本体目录 / 备用日志 | 快捷按钮 | `POST /api/open {target:"standbyWeb"|"standbyFolder"|"standbyLogs"}` |

- 部署/初始化进度走日志面板（SSE `deploy action=standby`）；备用端异常退出只记录日志并刷新，**不弹主端致命窗**、不触碰主 dsh 与 `config.dshRoot`。
- 备用端配置键：`standbyRoot`（默认 `.dsh_temp/dsh`）、`standbyHome`（默认 `.dsh_temp/.dsh`，支持绝对路径）、`standbyWebPort`（固定默认 3090，与主 `webPort` 解耦）、`standbyTag`（默认 `dsh-v0.1.3-alpha.1`）。
- **部署约束**：备用端目录 `.dsh_temp/` 整体 gitignore——**不提交仓库、不随启动器更新**；本机与新设备都要在「管理 dsh → 备用服务器（默认折叠）」按与正常部署相同的流程**手动部署**（克隆固定版本 → 构建 → 初始化用户目录）。
- **折叠区部署按钮（自动检测）**：部署由折叠区内「部署备用端」按钮触发，后端先检测备用本体目录（默认 `.dsh_temp/dsh`）与关键文件再决定：空/缺失 → 全新克隆固定版本；已是 git 仓库 → 同步固定版本并重建；**非空且非 git**（dsh 源码或残留）→ 拒绝覆盖并提示清理/改 `standbyRoot`。已部署后可点「重新部署/同步」走同一检测逻辑。折叠区展示「目录检测」结果行。

### 跨设备部署同版本（备用端）

1. 新机器先部署 dsh-launcher（`setup.cmd`）；
2. UI「管理 dsh → 备用服务器（默认折叠）→ 部署备用端（固定版本）」按与正常部署同流程执行 clone + 构建；「初始化用户目录」装好 router/sidebar 并把 `skills/dsh-operations` 复制进独立 `.dsh`；
3. 离线时手动：clone 同 tag 到 `.dsh_temp/dsh` → `pnpm install && pnpm run build && pnpm run build:web` → 设 `DSH_HOME` 指向独立 `.dsh` 后按「插件管理」补 router（注入器+预设）与 sidebar。

### 快速上手（备用端，约 10 分钟）

1. **部署备用端**（管理 dsh → 备用服务器，默认折叠 →「部署备用端（自动检测目录）」）：按钮先自动检测 `.dsh_temp/dsh` 目录与关键文件——空/缺失 → `git clone --depth 1 --branch dsh-v0.1.3-alpha.1`；已是 git 仓库 → fetch tag + 同步 → `pnpm install` → `pnpm run build` → `build:web`（与「一键部署 dsh」同一引擎，进度走底部日志面板；`/api/standby/status` 的 `deployed/distOk` 变 true 即完成）。
2. **初始化用户目录**（「初始化用户目录」）：自动完成 注入器装配 + router 预设落盘（含 v0.7.7+ 的 0.1.3 兼容层）+ `dsh-better-sidebar@0.18.0` + 把运维 skill 复制进独立 `.dsh/skills/dsh-operations`。首次失败会自动「启动一次再重试」。
3. **启动备用端**（端口默认 3090）→「打开备用 UI」：按钮会从备用 console 日志自动带上 `?token=`（无 token 时 dsh 根路径 401，属正常鉴权）。
4. 用完「停止」即可；备用端与主端**零共享**（DSH_HOME 独立、config 不切换、进程树独立）。

### skill `dsh-operations` 使用方法（人 / 智能体）

- **仓库内**：`.agents/skills/dsh-operations/SKILL.md`——工作目录在 dsh-launcher 的会话自动进入 skill 目录（`<projectRoot>/.agents/skills`）；任何人可直接读该文件照做。
- **备用端**：初始化用户目录时已复制到独立 `.dsh` 的 `skills/`（user-dsh skill 根），备用端会话自动可加载。
- **怎么用**：在 dsh GUI 会话里说一句「加载 dsh-operations skill，按故障库定位并修复…」，或直接提问该 skill 覆盖的问题（启动即退、Router 崩溃、探活、更新/插件事故、备用端切换等）；修复主 dsh 的标准流程见 skill 第 4 节。
- **要点**：先只读取证（`/api/logs`、`server.console.log`、`/api/status`、`/api/plugins`）再动手；任何会重启 3080 主 dsh 的操作先征求用户同意。

### 备用端 FAQ

| 问题 | 处理 |
|---|---|
| 备用端起不来：端口被占 | `netstat -ano \| findstr :3090` 释放，或 config 改 `standbyWebPort`（重启启动器生效） |
| 「初始化用户目录」提示 profile 未初始化 | 先「启动备用端」一次让其生成 profiles/storages 骨架 → 停止 → 再初始化（UI 会自动重试一次） |
| 打开备用 UI 只见 401/JSON | 属正常鉴权：用「打开备用日志」从 `server.console.log` 复制 `?token=` 完整地址，或直接点「打开备用 UI」（v0.8.0+ 自动带 token） |
| 主端修好后如何收尾 | 「停止」备用端即可；数据保留在 `.dsh_temp/.dsh`，随时再启 |

## 用量分析（数据格式与版本适配）

- **数据源**：`DSH_HOME/sessions/<project>/<sid>/` 下的会话日志，zstd 多帧解压（或明文 jsonl）。
- **v0.8.x 适配 dsh 0.1.3-alpha.1 的双日志格式**：
  - v0 流式日志 `session.jsonl.zstd`：token 记账在 `assistant/chunk` 行的 `data.chunk.usage`（chunk.type=`usage`）；
  - v2 持久日志 `session.v2.jsonl.zstd`（新会话/已迁移会话）：token 记账在 `assistant/message` 行的 `data.usage`；
  - **同一会话自动取最高版本文件**（v2 覆盖 v0/v1 残余），避免新旧重复计数；`session.migration.*.tmp` 与生成计数文件（如 `session.9.v2.jsonl`）一律忽略。
- **字段**：`inputTokens / outputTokens / cacheReadTokens`（`reasoningTokens` 仅存档、不计费）；模型归属取最近一次 `request/header` 的 `data.header.config.model`。
- **计费**：多模型单价表 + 峰谷时段 + 周末规则全部可在「用量分析」页自定义（`GET/POST /api/usage/pricing`），默认官方 DeepSeek 定价。
- **已知口径**：v1/v2 并存且 v1 时间戳更早属正常（迁移冻结），统计以最高版本文件为准；切换 DSH_HOME 后需刷新页面。

## API（127.0.0.1:5177）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 服务器状态（端口监听 + HTTP 探活 + 进程/PID + busy；`httpCode`；`standby` 摘要） |
| GET | `/api/env` | 工具链版本（node/pnpm/git/便携 Node）与部署路径 |
| GET | `/api/logs?tail=N` / `?since=<seq>` | 日志（环形缓冲，SSE 同源） |
| GET | `/api/events` | SSE：`log` / `status` / `refresh` / `deploy`（部署与更新共用，带 `action`） |
| POST | `/api/server/start` `/stop` `/restart` | dsh 服务器生命周期（taskkill 进程树 + 端口兜底） |
| GET | `/api/standby/status` | 备用服务器状态（部署/初始化/运行/HTTP 码 + 路径端口） |
| POST | `/api/standby/bootstrap` | 部署备用端（clone 固定 tag `dsh-v0.1.3-alpha.1` + install + build，SSE 进度） |
| POST | `/api/standby/provision` | 初始化备用端独立用户目录（router + sidebar@0.18 + 运维 skill） |
| POST | `/api/standby/start` `/stop` `/restart` | 备用服务器生命周期（独立端口 3090 + DSH_HOME，不触发主端致命弹窗） |
| GET | `/api/deploy/status?dir=` | 目录部署状态（git/依赖/构建/版本/入口） |
| POST | `/api/deploy` `{targetDir, skipBuild}` | 一键部署（异步，SSE 推进度，成功自动切换 dshRoot） |
| GET | `/api/update/check` | 更新检查：本地版本信息 + GitHub Releases（含更新内容）+ 客户端 bundle 健康 |
| POST | `/api/update/apply` `{version?, skipBuild?}` | 版本选择更新（默认最新 master；自动停服 + clean 全量重建 + 校验） |
| POST | `/api/update/repair` | 修复客户端构建（clean + install + build + 校验，不碰 git） |
| POST | `/api/config` `{dshRoot, dshHome, webPort, ...}` | 更新并持久化配置（dshHome 支持 null=默认 / `~` 展开 / 相对 dshRoot） |
| POST | `/api/open` `{target: web\|folder\|vscode\|logs\|standbyWeb\|standbyFolder\|standbyLogs}` | 打开 Web UI / 仓库目录 / VSCode / 日志 / 备用 UI / 备用本体目录 / 备用日志 |

## Python 工具（tools\）

```sh
tools\plugin.cmd list                    # 列出 profile 已装 bundle（含禁用标记）
tools\plugin.cmd install <pkg>           # dsh plugin --profile web add <pkg>
tools\plugin.cmd remove <pkg>
tools\plugin.cmd disable <bundle>        # pyyaml 编辑 cordis.patch.yml 禁用
tools\plugin.cmd enable <bundle>
```

## 新机器部署流程

1. 复制整个 `J:\dsh-launcher` 到新机器（含 `.runtime\` 与 `dist\`，约 300MB，无需预装 Node/Python）
2. 双击 `setup.cmd`（便携 Node/Python 已在包内则秒过；缺失才下载）
3. 双击 `launcher.cmd` → 「部署 dsh」→ 输入目录 → 一键部署 → 「概览」→ 启动

## 常见问题

| 问题 | 解决 |
|---|---|
| 双击 `launcher.cmd` 闪退 | 批处理必须保持**纯 ASCII + CRLF**（cmd 用系统 ANSI 代码页解析，中文/UTF-8 无 BOM 会闪退） |
| 端口被占用无法启动 | 启动器端口默认 5177：`launcher.cmd --port 5190`；dsh 端口被占（如主 GUI 3080）属预期，会明确提示 |
| 更新被拒绝："端口正被其他进程占用" | 目标 webPort 上有非启动器进程在跑（如另一实例），先停止该 dsh 再更新 |
| "bundle script ... failed to load" | 「更新 dsh」页 → 修复客户端构建 → 重启服务器 → 浏览器硬刷新（详见上文修复章节） |
| 浏览器显示旧界面 | 硬刷新 Ctrl+Shift+R（rev 为缓存戳，新页面自动带新 rev） |
| 更新后插件不生效 | 插件在 `~\.dsh\profiles\web`（用户层），与仓库版本独立；`tools\plugin.cmd` 管理 |
| 更新 dsh 到 0.1.3-alpha.1 后，新会话报 `本轮运行失败 Cannot read properties of undefined (reading 'find')` | Router 预设还在裸读已被新版 dsh 移除的 `session.events` 属性 → 已按下方「故障记录 2026-09-04」章节做本地兼容补丁，重启 dsh 后验证 |
| 更新 dsh 后**启动即退 code=1**（日志含 `@deepseek-ai/dsh-settings` 不提供 `settingsNamespace`） | 旧版 dsh-better-sidebar 不兼容 0.1.3-alpha.1 → 更新插件 ≥0.18.0 / 临时禁用；详见「故障记录 2026-09-04（续）」 |
| 服务其实健康但 UI 显示"启动中…"/探活红 | 旧探活只认 HTTP 200，而 dsh web 根路径带 token 鉴权返回 401 → v0.8.0 已改为任意 HTTP 响应即在线（`httpCode` 显示） |
| 主端升级/插件事故无法启动 | 「管理 dsh → 备用服务器（默认折叠）」：部署/启动固定版本备用端（端口 3090）→ 打开备用 UI 让智能体按内置 skill 修复主端（vibecoding 式自愈） |

## 事件管理器（「事件管理器」页）

- **事件记录**：webui 与 dsh 产生的事件（环形缓冲 2000 条，SSE 实时推送）
  - **正常日志**（启动/停止/重启等）不特意标注（info）
  - **警告事件**黄色标记（如端口未释放、构建许可写入、预设结构异常）
  - **错误事件**红色标记（如服务器异常退出、更新/构建/插件安装失败）
  - 支持按级别过滤（全部/错误/警告/正常）+ 计数徽章
- **日志查看**：可**打开日志文件夹**（`dshRoot\.dshctl\`，含 `server.console.log`）在资源管理器中查看服务端日志
- **致命错误处理**：检测到致命错误时**终止导致错误的进程**并**弹出错误提示**，可选：
  - **查看日志**：打开日志目录定位原因
  - **尝试恢复**：
    - 更新 dsh 本体造成 → **回退到更新前版本** + 全量重建 + 客户端 bundle/环境校验（快照持久化到 `.dshctl\backups\lastop.json`，后端重启后仍可恢复）
    - 插件安装造成 → **清除安装内容**（卸载该插件）+ **还原 cordis.patch.yml**（安装前自动备份）

## 设置与启动器更新（「设置」页）

- **基本参数**：dsh 启动端口（webPort）、WebUI 启动端口（launcherPort）、profile；保存后写入 config.json，**下次启动生效**（launcherPort 变更需重启启动器，webPort 变更下次启动 dsh 时生效）
- **检查启动器更新**：对比本仓库 GitHub Releases 最新版，显示当前/最新版本与更新内容
- **分步更新（不中断当前进程）**：
  1. 当前进程内：`git pull` 拉最新源码（已加载模块不受影响）→ `pnpm install` → `pnpm run build`（serveStatic 逐请求读盘 → **前端更新即时生效**）
  2. 写 `.update-pending` 标记并提示**重启完成剩余更新**
  3. 重启 `launcher.cmd` 时自动检测标记 → `pnpm install` 收尾 → 清除标记 → 正常启动
  - 全程**不杀死当前进程**、不产生致命错误；更新失败仅记录错误事件

## 故障记录 2026-09-04：dsh 0.1.3-alpha.1 更新后 Router 预设崩溃（reading 'find'）

> 定位 + 本地修复已落地（改的是 `~\.dsh` 数据层预设，**未改本仓库代码/上游**）。补丁在磁盘，dsh 服务器已停，**待重启验证**。

### 现象

- 用启动器把 dsh「更新」到 master（**实际为全新 clone** → `@deepseek-ai/dsh-root 0.1.3-alpha.1`，commit `d347e70`）后，任何选中 **Router Standard / Router Spec** 预设的新会话首轮即失败。
- dsh web UI 顶部显示：`本轮运行失败 Cannot read properties of undefined (reading 'find')`（即 `message.turnError`）。
- 该崩溃**与注入器是否启用无关**：即使 `@dsh-external/dsh-super-injector` 在 profile web 被 `disabled: true`，预设代码独立运行仍崩。

### 根因（已实证）

1. **dsh 0.1.3 Session 事件 API 变更**：新 `Session` 类不再暴露 `.events` 数组属性（`packages/core/session/src/index.ts`），事件改为私有 append-only log，读取走 `snapshotEvents()/ownEvents()/eventAt()` + surface 投影。旧代码读 `session.events` 恒为 `undefined`。
2. **routing-suite 预设仍裸读 `.events`**（`~/.dsh/.agent-presets/router-*`，2026-08-18 由启动器安装的旧代码）：
   - `router-core.mjs` → `sessionMode()`：`const events = session.events; events.find(...)` → 对 `undefined.find` 抛 TypeError（**就是报错来源**）。
   - `router-bootstrap-v1.mjs` → 装配钩子 `session.events.some(...)` 同类。
3. **触发时机** = 新会话首次 `system-prompt/assemble`：此时 `firstUserText` 尚未捕获，代码回退 `sessionMode(session)`（bootstrap 的 issue #3 修复分支，见注释）→ 抛错 → 整轮失败。
4. **为什么预设没跟上**：
   - 2026-09-04 曾重装 routing-suite，但上游仓库布局已从 `preset/preset/<name>` 改为 `preset/<name>`，本启动器 [server/plugins.mjs](server/plugins.mjs#L447) 安装路径不匹配 → 日志 `⚠ 预设 router-standard/router-spec 结构异常（缺少 agent.cordis.yml）→ 已跳过`，结果 `注入器 + 0/2 预设`，旧代码原样保留。
   - 上游 master（用 `.dsh_temp` 临时 clone 对比）：`preset/router-standard`（v34）已加 `session.events || []` 防护；**`preset/router-spec`（v10）仍裸写 `session.events.find`** —— 上游也未完全适配 0.1.3，只靠重装上游解决不了 spec。
   - 注入器 Release 预构建（`dsh-super-injector` 0.3.3）仍停留于「按 dsh 0.1.0-rc.6 语义」时期。

### 修复内容（本地补丁）

- **范围**：`~/.dsh/.agent-presets/router-standard` 与 `router-spec`（两目录原文件字节级一致，改动同步到三个文件）。
- **`router-core.mjs`**：新增并导出 `sessionEvents(session)` 兼容读取函数，`sessionMode()` 改用它。取值优先级：
  1. 新版 dsh：`session.snapshotEvents()`（完整日志，**保留 resume 语义**）；
  2. 旧版：`session.events` 数组；
  3. 过渡：`session.ownEvents()`；
  4. 兜底 `[]`（不再抛错，回退 weak 路由）。
- **`router-bootstrap-v1.mjs`**（及等同副本 `router-bootstrap.mjs`）：导入 `sessionEvents`，把会崩的 `session.events.some(...)` 改为 `sessionEvents(session).some(...)`。
- **备份**：改动前原文件已存 `~/.dsh/.agent-presets/.patch-backup-20260904/`（回退/对照用）。
- **验证**：`node --check` 语法全过；冒烟测试——新版 Session（仅 `snapshotEvents`）路由分类正常、旧版 `.events` 正常、空/无事件 Session 返回 `weak` 不崩。
- **生效**：重启 dsh 服务器后加载新模块（已执行停止，端口 3080 已释放，待从启动器重新启动验证）。

### 待办 / 后续建议

- [x] 重启 dsh → 新建 Router Spec/Standard 会话，确认不再出现「本轮运行失败」（2026-09-04 晚已重启，补丁进程生效；会话级验证由用户在 GUI 完成）。
- [x] **v0.7.7 根因修复**：本启动器 [server/plugins.mjs](server/plugins.mjs) 预设安装逻辑适配上游新布局 `preset/<name>`（兼容旧 `preset/preset/<name>`），重装 routing-suite 不再 0/2 跳过：
  - 落盘后自动做 **dsh 0.1.3 Session API 兼容审计**：发现仍裸读 `session.events` 的文件（含上游未适配的旧副本）→ 自动注入 `sessionEvents()` 兼容读取（`.events` → `snapshotEvents()` → `ownEvents()` → `[]`）并改写调用点；每个改写文件经 `node --check` 校验，失败自动回滚；
  - 上游已适配代码（router-standard v34 / router-spec v10 装载链）逐字节保持不动；
  - 覆盖旧预设前整体备份到 `.patch-backup-<ts>/`（保留最近 3 份），手动补丁/旧版本可回退。
- 上游 router-spec 装载链（v10）已按 0.1.3 适配；若上游后续再带回未适配代码，本启动器安装时会自动补丁兜底。
- 本机 `.dsh_temp` 已升级为**备用服务器 + 测试端**（见下「备用服务器（.dsh_temp）」章节）：`dsh/` 固定版本本体 + `.dsh/` 独立用户目录 + `upstream/` routing-suite 对照 clone；整体 gitignore、不随启动器更新。

## 故障记录 2026-09-04（续）：dsh 0.1.3-alpha.1 更新后「启动即退 code=1」——better-sidebar 兼容性（已实证 + 组合登记）

> 登记版本组合：**launcher 0.7.7/0.8.0 ↔ dsh `dsh-v0.1.3-alpha.1`（commit `d347e70`）↔ 插件仅 router 相关 + `dsh-better-sidebar@≥0.18.0`**。

### 现象

- 用启动器「更新 dsh」到 0.1.3-alpha.1（全新 clone，d347e70）后，概览页启动服务器卡"启动中…"，随即 `[launcher] dsh 服务器已退出 (code=1)` + 致命弹窗「尝试恢复」。
- 环形日志 / `server.console.log` 中的 loader 错误链：
  `failed to apply loader entry include … failed to import loader entry better-sidebar (dsh-better-sidebar): The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'`，
  底层为旧版 `C:\Users\<user>\.dsh\profiles\web\node_modules\dsh-better-sidebar\lib\index.js` 的 `import { SettingsConflictError, settingsNamespace } from "@deepseek-ai/dsh-settings"`。

### 根因（已实证）

1. **dsh 0.1.3-alpha.1 移除 `@deepseek-ai/dsh-settings` 的 `settingsNamespace` 导出**（设置域 API 变更）；
2. **`dsh-better-sidebar` <0.18** 仍 import 该名字 → ESM 加载即抛 SyntaxError → cordis include 应用失败 → **boot 中止、进程 code=1**；
3. 0.18.0 起该 import 已移除（本机 2026-09-04 12:09 `add @latest` 后实测启动恢复正常，12:47 起持续健康运行）。

### 修复方案（按序）

1. `tools\plugin.cmd install dsh-better-sidebar@0.18.0`（或 UI「插件管理 → 更新」）→ 重启 dsh；
2. 仍失败则临时 `tools\plugin.cmd disable dsh-better-sidebar` 先恢复服务（重启生效）；
3. 兜底：对 `profiles/web/node_modules/dsh-better-sidebar/lib/index.js` 去掉该 import（会被重装覆盖）。

### 升级 dsh 的行为警告（v0.8.0 起在「更新 dsh」页常驻提示）

- dsh 处于开发者预览阶段，**版本间存在破坏性 API 变更**：Session 事件 API（`.events` → `snapshotEvents()`）、`dsh-settings` 导出、agent-preset 布局等均曾破坏插件/预设；
- 升级前请确认插件兼容（本机事故即旧 sidebar 撞新 dsh）；升级后若主端异常，**在「管理 dsh → 备用服务器（默认折叠）」部署/启动固定版本备用端进入修复**，不必等主端恢复。

### 探活误判修复（v0.8.0）

- 现象补充：即便服务健康，启动器探活曾只认 HTTP 200，而 dsh web 根路径无 token 返回 **401** → UI 显示"启动中…"/探活红（F3 假象）。
- v0.8.0 起探活把**任何 HTTP 响应**视为服务在线，`/api/status` 新增 `httpCode`（401/302/200 均属健康）。

## 更新日志

版本历史已独立成文：[UPDATE.md](UPDATE.md)（v0.8.0 → v0.1.0，含故障修复说明与变更记录）。

## 安全与说明

- 后端仅监听 `127.0.0.1`，无外部暴露面；停止服务器用 `taskkill /T /F` 清理进程树并以端口兜底
- `.runtime\`、`node_modules\`、`dist\`、`dsh-test\`、`.dsh_temp\` 已 gitignore，套件根可整体压缩分发
- 后端零运行时依赖：运行只需 `.runtime\node\node.exe` + `server\index.mjs` + `dist\`，无 `node_modules` 也能跑
- 文档不含用户名/凭据/token：路径均为安装示例，用户名一律以 `<user>` 占位；本机个人配置（`config.json`、`.dshctl/`）与备用端数据（`.dsh_temp/`）不入库
- 版本历史见 [UPDATE.md](UPDATE.md)（v0.8.0 → v0.1.0，含故障修复说明与变更记录）
