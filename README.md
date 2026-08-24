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

## 更新日志

### v0.7.5 — 修复新机器构建报 "'pnpm' 不是内部或外部命令" + 日志 GBK 乱码

- **根因**：环境检查虽能读到套件 pnpm，但**构建子进程的 PATH 里没有 `.runtime\node`**——dsh 根构建脚本内部用裸 `pnpm --filter ...` 调 `build:web`，新机器系统 PATH 无 pnpm 即报错，导致 `pnpm run build` 失败
- **修复**：新增 `kitEnv()`，所有构建/安装命令（更新/部署/恢复/修复/启动器自更新/服务器启动）统一**把套件 node 目录前置到 PATH**，子进程裸 `pnpm` 一律可解析（实测：无套件 PATH 复现报错，前置后 pnpm 11.7.0 正常）
- **日志 GBK 乱码修复**：Windows 中文 cmd/pnpm 输出为 GBK，子进程输出改为 UTF-8 优先 + 检测替换符后 **GBK 回退解码**（中文报错可读）

### v0.7.4 — .dshctl 数据目录收敛到启动器目录（按 dsh 本体区分）

- `.dshctl` 不再散落在 dsh 本体目录：会话备份 / 恢复快照 / 启动器日志 / server.console.log 统一收敛到 **`<webui>/.dshctl/<dsh 本体键>/`**（键 = dsh 根目录绝对路径去特殊字符，如 `J__deepseek_harness`、`G__deepseek_harness`，不同 dsh 本体互不混淆）
- 路径示例：`<webui>/.dshctl/J__deepseek_harness/backups/`、`.../logs/launcher-<时间>.log`、`.../server.console.log`
- **启动时自动迁移**旧位置 `<dshRoot>/.dshctl` 下的 backups / logs / server.console.log 到新目录（原目录保留可手动删除）
- 插件安装前的 patch 备份（plugins.mjs）、「打开日志」按钮、设置页说明同步更新

### v0.7.3 — 环境检查 pnpm 解析修复（新机器显示 ?）

- 修复新机器「开发环境」页 pnpm 显示 `?`：环境检查原来只查系统 PATH 的 pnpm（`cmd /c pnpm --version`），新机器 pnpm 只装在套件 `.runtime\node`（setup.cmd 安装）时显示 ?
- 改为**优先套件便携 pnpm**（`.runtime\node\pnpm.cmd`），系统 PATH 无 pnpm 也能正确显示
- 「开发环境」页新增 **便携 pnpm (.runtime)** 行，与便携 Node 并列展示

### v0.7.2 — 修复环境构建（全量）+ 更新/拉取后自动全量重建

- **「修复客户端构建」升级为「修复环境构建（全量）」**：随时可点（不再仅在 bundle 异常时出现），clean + 全量构建（含前端 `apps/web/dist` 与全部客户端 bundle），不碰 git；解决 "frontend dist not built" / "bundle script failed to load" / 网页未构建
- **`setup.cmd` 前端部分改为无条件全量重建**（不再因 node_modules / dist 存在而跳过）：内置更新或外部 git pull 后执行 `setup.cmd` 即 install + build 全量重出，网页不会停留在未构建/旧构建状态
- **`.update-pending` 收尾补跑 `pnpm run build`**：`launcher_boot.py` 重启收尾从仅 install 升级为 install + build 全量重建
- 更新页 bundle 健康检查文案同步（含前端 web dist 项）

### v0.7.1 — 启动器日志按启动时间落盘 + dsh 前端 dist 自动补建

- **启动器日志持久化**：每次启动 WebUI 检查并创建日志目录（`dshRoot/.dshctl/logs/`），本次启动的全部日志写入 **`launcher-<启动时间>.log`**（UTF-8，含时间/级别/来源）
  - 日志目录或文件被删除后**自动重建**（Windows 上已打开的文件被删不会触发错误事件，采用存在性探测 + 节流重建），日志不再丢失
- **修复 dsh 在全新机器上启动失败**（`web-app: frontend dist not built`）：
  - 原因：dsh 根目录 `pnpm run build` 不产出前端 `apps/web/dist`，而 `web-app` bundle 启动时强制 require 该 dist
  - 更新/部署/恢复/修复四条构建路径在 dist 缺失时**自动补跑 `pnpm run build:web`**
  - 「客户端 bundle 健康检查」新增 `@deepseek-ai/dsh-web-app（前端 dist）` 项，缺失会提示并可一键修复

### v0.7.0 — 用量分析：多模型计价 + 日期级峰谷（周末规则 2026-08-23 起生效）

- **多模型分别计价**（官方定价表，元/百万 token 高峰价）：
  - `deepseek-v4-flash`：输入 3.0 / 输出 9.0 / 缓存命中 0.1
  - `deepseek-v4-pro`：输入 9.0 / 输出 27.0 / 缓存命中 0.3
  - `deepseek-v4-flash-vision-exp`：输入 3.0 / 输出 9.0 / 缓存命中 0.1
  - `_default` 兜底（未列出的模型）；全部可在页面修改，**数据中出现的新模型自动出现在编辑器**
  - 新增**模型构成图样**（各模型 tokens 与费用横向条，多模型分别计价显示）
- **周末规则按日期精确生效**：官方 2026-08-23（周日）00:00 起周末（六/日）全天按空闲价；**此前周末仍分峰谷时段**。新增 `weekendFlatStart` 配置（可自定义生效日期，留空 = 始终生效），计价聚合升级为**日期 × 小时 × 模型**（`byDayHour`），前后数据分别精确计费
- **日期 × 小时消耗热力**（替换原星期×小时热力）：按真实日期逐行标注峰谷——8/22（周六，规则前）高峰描边、8/23（周日，规则起）周末全天空闲，与官方口径一致
- 计价编辑器升级：全局（高峰时段增删 / 空闲倍率 / 周末规则开关 + 生效日期）+ 各模型折叠单价编辑 + 「恢复官方默认」
- 会话级分析同步支持多模型与日期级峰谷（会话 dayHour 桶）
- 兼容旧版扁平单价配置（自动映射到 `_default`）；`POST /api/usage/pricing` 走 `mergePricing` 深度合并
- 新 API 字段：`GET /api/usage` 新增 `byModel`、`byDayHour`

### v0.6.3 — 修复 detached HEAD 切换后 pull 失败（无上游追踪）

- 修复 v0.6.2 的遗漏：`checkout -B master` 切回分支后本地分支**暂无上游追踪**，`git pull --ff-only` 仍会失败（"no tracking information"）
- 更新器改为 **`git pull --ff-only origin master`**（显式指定远端+分支，无需上游配置），并在切回后 best-effort 补设 `branch --set-upstream-to=origin/master`

### v0.6.2 — 启动器更新器修复（detached HEAD + zip 安装模式）

- **修复内置更新器报错** "You are not currently on a branch"：git 安装若处于 **detached HEAD**（如手动 `git checkout <tag>` / 标签检出），更新器现在会自动 `fetch origin` → 校验本地是远程祖先（安全）→ 切回 `master` 分支 → 再 `git pull --ff-only`；与远程分叉时明确报错而非盲目覆盖
- **兼容 zip 下载构建的安装方式**（无 `.git`）：更新器自动检测安装模式
  - git 安装：走 git pull 更新
  - zip 安装：**下载最新 Release 源码包** → Windows 自带 tar 解压 → 在新源码目录 `pnpm install` + `pnpm run build` → **整体替换**启动器目录（保留 `config.json` / `.dshctl` 数据 / `.runtime` 内置运行时）→ 写重启标记，全程不中断当前进程
- 设置页显示「安装方式」（git 仓库 / zip 源码包），按钮与说明随模式变化

### v0.6.1 — 会话级 Token 分析

- **「用量分析」页新增会话级分析**
  - **会话费用对比条**：各会话实时费用（峰谷计价）横向对比，最高会话高亮
  - **会话详情钻取**：点会话行「分析」展开——
    - Token 构成饼图（缓存命中 / 输入未命中 / 输出 / 缓存写入）
    - 峰谷账单（高峰 / 空闲 / 合计 / 相对全高峰节省，随单价实时重算）
    - 24 小时消耗分布（高峰时段高亮）
    - 元信息：模型 / 时长 / 起止时间 / usage 事件数
  - 会话表「费用」列改为**峰谷实时计算**，并新增缓存读列
- 后端 `GET /api/usage` 的 `bySession` 增加 `events` / `firstTs` / `hourWeek`（会话内 168 桶聚合，供前端实时计费）

### v0.6.0 — 用量分析（Token 消耗图 + 峰谷计费账单）

- **新增「用量分析」页**：Token 消耗可视化与峰谷计费
  - **Token 构成饼图**（conic-gradient）：缓存命中输入 / 输入(未命中) / 输出 / 缓存写入，悬浮与图例显示数量、占比、单价
  - **峰谷账单**：按「星期×小时」聚合（168 桶）实时计费——高峰费用 / 空闲费用 / 相对全高峰节省 / 高峰 token 占比；**单价、峰谷时段、空闲倍率、周末规则修改后账单立即重算**
  - **30 天消耗柱状图**（输入+输出）+ **24 小时消耗分布**（高峰时段橙色高亮，悬浮显示各类 tokens）
  - **星期 × 小时消耗热力**（168 格，峰值格子描边，周末行标注空闲价）
  - **GitHub 风格热力图**（近 365 天，按日用量分级着色，悬浮显示日期/tokens/费用）
  - 统计卡：总费用 / 输入 / 输出 / 缓存读取 / 会话数 / 活跃天数
  - 最近 30 天明细表 + 会话明细（项目/模型/输入/输出/费用）
- **峰谷计价默认值取自 DeepSeek 官方定价文档**（[api-docs.deepseek.com/zh-cn/quick_start/pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)）：
  - 高峰时段 9:00-12:00 / 14:00-18:00（北京时间）；空闲 = 高峰 × 0.5；周末（周六/日）全天按空闲价（2026-08-23 起）
  - deepseek-v4-flash 高峰价：输入 ¥3 / 输出 ¥9 / 缓存命中 ¥0.1 / 缓存写入 ¥3（元/百万 token）
  - 全部可在页面修改并持久化到 config.json（`POST /api/usage/pricing`）
- 数据源：`DSH_HOME/sessions/**/session.jsonl.zstd`（zstd 多帧解压，移植 dsh 帧扫描；Node `node:zlib` 零依赖）
- 新 API：`GET /api/usage`（新增 `byHourWeek` 168 桶聚合）、`POST /api/usage/pricing`

### v0.5.2 — 修复会话备份 cpSync 未定义

- **修复会话备份失败**（"cpSync is not defined"）：`server/index.mjs` 的 `node:fs` 导入缺失 `cpSync`/`rmSync`，导致备份与删除备份报错；已补全导入并实测（真实会话文件备份 files/size 正确、删除记录正常）

### v0.5.1 — 启动逻辑脚本化（修复 launcher.cmd 闪退）

- **修复 launcher.cmd 闪退**（"... was unexpected at this time"）：`.update-pending` 收尾段的 cmd 括号块变量预展开崩溃
- **启动逻辑全部移入 `tools/launcher_boot.py`**：更新收尾 / 已运行检测 / node 选择 / 端口解析 / 停止（--stop）全部 Python 承载，`launcher.cmd` / `launcher-stop.cmd` 仅负责调用（纯 ASCII+CRLF + goto 结构，规避 cmd 语法坑）

### v0.5.0 — 启动器设置、启动器自更新、会话备份与插件更新分级

- **新增「设置」页**：dsh 端口 / WebUI 端口 / profile 参数（下次启动生效）；检查启动器更新（版本对比 + 更新内容）；**会话备份记录**（时间/原因/手动备份/删除）
- **启动器分步更新**：git pull → install → build（前端即时生效）→ 写 `.update-pending` 标记 → 提示重启；`launcher.cmd` 重启时自动收尾（补依赖 + 清标记）；全程不中断当前进程
- **会话备份保护**：dsh 升级与插件安装/更新/卸载前**自动备份 `~/.dsh/sessions`**（`.dshctl/backups/sessions-<ts>/` + `backups.json` 记录），设置页可查看/手动备份/删除
- **插件更新分级路径**：npx 安装无需手动更新；源码构建（workspace 包）随 dsh 更新；用户安装走 `dsh plugin update`；better-sidebar 按 README 用 `add @latest`；**dsh-routing-suite 暂不更新**
- **升级后兼容性验证**：dsh 更新完成后自动启动 dsh → HTTP 探活 → 停止，确认插件兼容性
- **破坏性更新警告**：更新页提示 dsh 预览版阶段存在破坏性更新，贸然升级可能造成致命影响；插件管理页提示操作前自动备份会话（插件市场如 dsh-plugin-hub 安装的插件同样列出，可禁用/卸载）
- 新 API：`GET /api/launcher/check`、`POST /api/launcher/update`、`POST /api/backup`、`GET /api/backup/list`、`POST /api/backup/delete`、`POST /api/plugins/update`
- 修复 pnpm 11 脚本预检卡住（`verifyDepsBeforeRun: false`）

### v0.4.3 — 日志滚动修复与白天主题

- **修复日志刷新把页面拉到底**：自动滚动改为只滚动日志列表自身容器（不再用 scrollIntoView 影响外层页面）
- **新增白天/黑夜主题切换**：顶栏「白天/黑夜」按钮，CSS 变量主题化（深色默认 + `[data-theme="light"]` 浅色覆盖），localStorage 持久化
- 日志/事件区、弹窗、渐变背景等全部变量化，两主题一致观感

### v0.4.2 — 事件管理器与致命错误恢复

- **新增「事件管理器」页**：事件记录（info 不标注 / warn 黄 / error 红，级别过滤 + 计数）；打开日志文件夹（`.dshctl\`）
- **致命错误弹窗**：dsh 服务器异常退出 / 更新失败 / 插件安装失败 → 终止错误进程 + 弹窗（查看日志 / 尝试恢复 / 稍后处理）
- **智能恢复**：更新错误 → 回退更新前版本 + clean 全量重建 + bundle 校验；插件错误 → 卸载插件 + 还原 patch.yml 备份
- **恢复快照持久化**：`.dshctl\backups\lastop.json`，后端重启后仍可恢复
- 新 API：`GET /api/events/list`、`POST /api/recover`、`/api/open {target:"logs"}`
- 日志面板按事件级别着色（错误红 / 警告黄）

### v0.4.1 — 搜索改进与特殊插件扩展

- **搜索重写**：候选池（@deepseek-ai scope）+ 本地过滤，支持**精确搜索**（完整包名完全匹配，如 `dsh-bash-sandbox`）与**模糊搜索**（名称/描述包含，如 `sandbox` 返回全部 sandbox 系列），精确命中排最前
- **新增特殊插件 dsh-better-sidebar**（[GitHub](https://github.com/omdsh-dev/DSH-better-sidebar)）：VSCode 风格侧边栏工作台，npm 独立安装、无需修补
- 特殊插件卡片按各自安装方式调用（routing-suite 走特殊修复流程，better-sidebar 走 npm）

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
