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
├── launcher.cmd       双击入口：启动后端 + 自动开浏览器
├── launcher-stop.cmd  停止后端（支持 --port N）
├── setup.cmd          新机器引导：便携 Node/Python/venv + 构建前端
├── config.json        dshRoot 指向独立目录（相对路径可用）
└── dsh-test\          （可选）独立测试沙盒，已 gitignore
```

## 功能总览

| 页面 | 功能 |
|---|---|
| **概览** | 服务器启停/重启 + HTTP 探活 + PID/日志大小；环境信息（node/pnpm/git/便携 Node/dshRoot）；数据目录 DSH_HOME 配置（支持**文件夹选择器**）；一键打开 Web UI / 仓库目录 / VSCode；实时日志面板（过滤/跟随/清空视图） |
| **管理 dsh** | dsh 本体目录部署/切换/检查（一键部署 clone+install+build、**文件夹选择器**、切换 dshRoot） |
| **插件管理** | 已安装插件（含本体自带，本体不可修改）+ 禁用/启用/卸载；npm @deepseek-ai 搜索安装；特殊插件 dsh-routing-suite（注入器 + 路由预设，自动二次修复） |
| **更新 dsh** | 检查更新（GitHub Releases 同步更新内容）；版本选择升级（默认最新）；客户端 bundle 健康检测与一键修复 |

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
- **搜索安装**：关键词搜索 npm `@deepseek-ai/` 系列插件（npm registry search），一键 `dsh plugin add` 安装
  - 自动处理 pnpm 构建脚本拦截：写入 profile `pnpm-workspace.yaml` 的 `allowBuilds`（node-pty/esbuild）并失败重试
- **特殊插件**：dsh-routing-suite（[GitHub](https://github.com/yjh051108/dsh-routing-suite)）
  - 组成：`dsh-super-injector`（运行时注入器，dev_* 工具）+ `dsh-router-standard`（思维模式路由预设 Router Standard/Spec）
  - 安装流程自动完成**二次修复**：Release 预构建注入器下载（免构建）→ 装配进 profile bundles → 克隆套件（含子模块）→ 预设平铺复制到 `.agent-presets\`（DSH 只扫一级目录）→ `preset.yml` 描述引号修复
  - 完成后重启 dsh，新会话可选 Router Standard / Router Spec

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

## API（127.0.0.1:5177）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 服务器状态（端口监听 + HTTP 探活 + 进程/PID + busy） |
| GET | `/api/env` | 工具链版本（node/pnpm/git/便携 Node）与部署路径 |
| GET | `/api/logs?tail=N` / `?since=<seq>` | 日志（环形缓冲，SSE 同源） |
| GET | `/api/events` | SSE：`log` / `status` / `refresh` / `deploy`（部署与更新共用，带 `action`） |
| POST | `/api/server/start` `/stop` `/restart` | dsh 服务器生命周期（taskkill 进程树 + 端口兜底） |
| GET | `/api/deploy/status?dir=` | 目录部署状态（git/依赖/构建/版本/入口） |
| POST | `/api/deploy` `{targetDir, skipBuild}` | 一键部署（异步，SSE 推进度，成功自动切换 dshRoot） |
| GET | `/api/update/check` | 更新检查：本地版本信息 + GitHub Releases（含更新内容）+ 客户端 bundle 健康 |
| POST | `/api/update/apply` `{version?, skipBuild?}` | 版本选择更新（默认最新 master；自动停服 + clean 全量重建 + 校验） |
| POST | `/api/update/repair` | 修复客户端构建（clean + install + build + 校验，不碰 git） |
| POST | `/api/config` `{dshRoot, dshHome, webPort, ...}` | 更新并持久化配置（dshHome 支持 null=默认 / `~` 展开 / 相对 dshRoot） |
| POST | `/api/open` `{target: web\|folder\|vscode}` | 打开 Web UI / 仓库目录 / VSCode |

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

## 更新日志

### v0.4.0 — 插件管理

- **新增「插件管理」页**：列出已安装插件与本体自带插件（本体不可修改，后端强制保护）；禁用/启用（cordis.patch.yml）/卸载（dsh plugin remove）
- **npm 搜索安装**：关键词搜索 `@deepseek-ai/` 系列插件并一键安装；自动处理 pnpm 构建脚本拦截（allowBuilds + 重试）
- **特殊插件 dsh-routing-suite**：注入器 + 思维模式路由预设一键安装，内置二次修复（预构建注入器、子模块、预设平铺、YAML 引号修复）
- 「部署 dsh」更名「**管理 dsh**」
- 新 API：`GET /api/plugins`、`GET /api/plugins/search`、`POST /api/plugins/install|toggle|remove`
- 插件管理全程操作**当前 DSH_HOME**（隔离调试：测试 dsh 本体 + 测试 DSH_HOME）

### v0.3.2 — 目录选择器与检查稳定性

- **新增 Windows 原生文件夹选择器**：部署目录、DSH_HOME 数据目录均可点「浏览…」弹出系统文件夹对话框选择，选完自动填入并立即检查（`POST /api/pick-dir`，FolderBrowserDialog）
- **修复部署页检查被轮询覆盖**：手动检查指定目录后不再被 3s 状态轮询覆盖回默认 dshRoot（自动检查仅跟随 dshRoot 配置变化触发）

### v0.3.1 — 数据目录 DSH_HOME 可独立选取

- **新增 `dshHome` 配置**：`.dsh` 可放在项目目录（如 `dshRoot\.dsh`）或任意独立目录，不再局限于用户文件夹
- 后端 spawn dsh 时注入 `DSH_HOME`（dsh 官方 `home-paths`：显式配置 > `$DSH_HOME` > `~/.dsh`）；相对路径相对 dshRoot 解析，支持 `~` 展开
- UI：「概览 → 数据目录 DSH_HOME」输入/保存/恢复默认；`tools\plugin.py` 同步跟随
- 新增 CLI：`--dsh-home <path>`（`default` 恢复默认）；API `/api/config` 支持 `dshHome`

### v0.3.0 — 更新管理与修复（本次）

- **新增「更新 dsh」独立页面**：检查更新（同步 GitHub Releases 与更新内容）、版本选择升级（默认最新）、更新到最新 master
- **更新流程工程保护**：更新前自动停服（非启动器进程占用则拒绝）；版本切换后 `pnpm run clean` 强制全量重建；构建后客户端 bundle 健康校验
- **新增「修复客户端构建」**（`/api/update/repair`）：一键解决 "bundle script failed to load"（clean + install + 全量 build + 校验）
- 新增 API：`GET /api/update/check`、`POST /api/update/apply`、`POST /api/update/repair`
- 更新页显示 bundle 健康条（缺失红条 + 修复按钮）

### v0.2.0 — 便携套件化 + 一键部署

- 套件自包含：`.runtime\node`（便携 Node + pnpm）、`.runtime\python` + venv（便携 Python + pyyaml）
- dsh 本体独立存放（默认 `../deepseek_harness`），UI 支持目录检查/切换
- **一键部署 dsh**（`/api/deploy`）：clone + install + build 全自动，成功自动切换 dshRoot
- `setup.cmd` 新机器引导（幂等）；`launcher.cmd` 支持 `--port` / `--web-port` / `--profile`；`tools\plugin.py` 插件管理
- 修复：批处理中文编码闪退（改纯 ASCII + CRLF）、日志文件被占用导致后端崩溃（尽力而为写盘 + 异常兜底）

### v0.1.0 — MVP

- 服务器启停/重启 + HTTP 探活、实时日志（SSE）、环境信息、一键打开 Web UI/仓库/VSCode
- 深色玻璃拟态 UI：概览页 + 状态胶囊 + 日志面板（过滤/跟随/清空）

## 安全与说明

- 后端仅监听 `127.0.0.1`，无外部暴露面；停止服务器用 `taskkill /T /F` 清理进程树并以端口兜底
- `.runtime\`、`node_modules\`、`dist\`、`dsh-test\` 已 gitignore，套件根可整体压缩分发
- 后端零运行时依赖：运行只需 `.runtime\node\node.exe` + `server\index.mjs` + `dist\`，无 `node_modules` 也能跑
