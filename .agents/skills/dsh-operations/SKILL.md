---
name: dsh-operations
description: 修复与管理 DeepSeek Harness（dsh）及 dsh-launcher 启动器的运维手册。涉及：本机拓扑与路径表、启动器↔dsh 最稳定组合登记、备用服务器（.dsh_temp 固定版本 + 独立 DSH_HOME）的使用与跨设备部署、故障库（better-sidebar settingsNamespace 启动即退、Router 预设 session.events 崩溃、探活 401 误判、PATH/GBK/前端 dist 缺失等）的定位与修复步骤、恢复/回退流程、API 速查与工程约束。执行任何会重启/中断 dsh 主服务（如 3080 端口、当前 GUI）的操作前必须先向用户确认。
---

# dsh / dsh-launcher 运维手册

本 skill 供后续智能体（含备用服务器里的会话）修复与管理本机 dsh 与 dsh-launcher。先读「拓扑与版本登记」，再按故障库定位，最后按「修复流程」执行；不确定时先做只读探测（日志、文件、API），绝不臆测。

## 1. 拓扑与关键路径

> 下表为本机（示例安装）路径，不含用户名/凭据（用户名一律 `<user>` 占位）；换机器按实际安装目录替换即可。端口/端点以运行时 API 实况为准。

| 角色 | 路径 | 说明 |
|---|---|---|
| dsh-launcher | `G:\dsh-launcher` | 本仓库：前端 `src/`、后端 `server/index.mjs`（零依赖）+ `server/plugins.mjs` + `server/usage.mjs` + `server/standby.mjs`、Python 工具 `tools/`、便携运行时 `.runtime/`（node+pnpm）、产物 `dist/` |
| 主 dsh 本体 | `G:\dsh`（config.json `dshRoot`） | 用户自选目录，可换（管理 dsh 页）。当前 = 官方 `dsh-v0.1.3-alpha.1`（commit `d347e70`），浅克隆 |
| 主用户数据 | `C:\Users\<user>\.dsh`（config `dshHome`=null 时） | profiles/plugins/sessions/预设；`plugins/`（dsh-super-injector）、`profiles/web/cordis.patch.yml`（禁用标记）、`.agent-presets/router-*`（路由预设） |
| 启动器数据 | `G:\dsh-launcher\.dshctl\<dsh键>/` | 按 dsh 本体键隔离：`backups/`、`logs/launcher-*.log`、`server.console.log`、`lastop.json`（恢复快照） |
| **备用服务器** | `G:\dsh-launcher\.dsh_temp/dsh`（本体）+ `.dsh_temp/.dsh`（**独立 DSH_HOME**） | 固定版本、不入库、不随启动器更新；`upstream/`=routing-suite 对照 clone；此目录整体 gitignore |
| 运维 skill | `G:\dsh-launcher\.agents/skills/dsh-operations/SKILL.md`（仓库内） | 备用端初始化时复制到 `<standby home>/skills/dsh-operations/SKILL.md`（user-dsh skill 根） |

运行时事实（用 API 而非猜测）：
- 启动器 API：`http://127.0.0.1:5177`；主 dsh：`http://127.0.0.1:3080`（带 token）；备用 dsh：默认 `http://127.0.0.1:3090`。
- `GET /api/status`、`GET /api/env`、`GET /api/logs?tail=N`、`GET /api/events/list`、`GET /api/update/check`、`GET /api/standby/status`。
- 进程：启动器后端 PID 监听 5177；主 dsh web PID 监听 3080；备用（若启动）监听 3090。**3080 的 dsh 很可能就是当前会话运行的 GUI —— 重启前必须征得用户同意。**

## 2. 最稳定组合登记（跨设备部署同版本）

| 组件 | 版本 | 备注 |
|---|---|---|
| dsh-launcher | 0.8.0+ | git 仓库 `Kalcite/dsh-launcher-webui` |
| **dsh（主 + 备用固定）** | **`dsh-v0.1.3-alpha.1`（commit `d347e70`）** | 官方 release 线；备用端固定在它，主端升级后出问题可切备用 |
| 插件 | 仅 router 相关 + `dsh-better-sidebar@≥0.18.0` | sidebar <0.18 在新 dsh 上启动即退（见故障库 F1） |
| 备用端端口/profile | 3090 / web | 独立 DSH_HOME `.dsh_temp/.dsh`，插件只保留 router（注入器+预设）与 sidebar + 本 skill |

## 3. 故障库（先对号入座）

### F1 dsh 启动即退 code=1：`@deepseek-ai/dsh-settings` 不提供 `settingsNamespace`（已实证 2026-09-04）
- 现象：概览点启动 → "启动中…" → `[launcher] dsh 服务器已退出 (code=1)` + 致命弹窗；环形日志/`server.console.log` 有：
  `failed to import loader entry better-sidebar (dsh-better-sidebar): The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'`（旧版 `lib/index.js` import 该名字）。
- 根因：dsh 0.1.3-alpha.1 移除/改名 `settingsNamespace`；better-sidebar **<0.18** 仍 import 它 → loader include 失败 → boot 中止。
- 修复（按序）：① 更新插件到 `dsh-better-sidebar@0.18.0`+：`tools\plugin.cmd install dsh-better-sidebar@0.18.0`（或 UI 插件管理更新）→ 重启 dsh；② 若仍失败临时禁用：`tools\plugin.cmd disable dsh-better-sidebar`（重启生效）以便先恢复服务；③ 永久方案等上游适配，或对 `profiles/web/node_modules/dsh-better-sidebar/lib/index.js` 去掉该 import（会被重装覆盖）。
- 版本组合警告：升级 dsh 本体前先在 UI 更新页查看警告；alpha/预览版存在破坏性 API 变更（Session.events、dsh-settings 导出、preset 布局等），**优先在备用端验证后再动主端**。

### F2 更新 dsh 后 Router 预设崩溃：`Cannot read properties of undefined (reading 'find')`
- 根因：dsh 0.1.3 移除 `Session.events` 数组（私有 append-only log，读走 `snapshotEvents()/ownEvents()`）；旧预设（2026-08-18 前代码）裸读 `session.events.find/some` → 首轮 `system-prompt/assemble` 抛错。
- 处理：① 已装预设若裸读：按 `server/plugins.mjs` 的 `sessionEvents()` 兼容层手工补丁（备份到 `.patch-backup-<ts>/`）；② 重装 routing-suite 用 v0.7.7+ 启动器（双布局 `preset/<name>` + 0.1.3 兼容层自动落盘，不再 0/2 跳过）；③ 上游 router-spec 旧副本也可能裸读——交给安装期自动补丁。
- 验证：重启 dsh → 新建 Router Spec/Standard 会话看首轮是否通过（会用到当前 GUI，注意确认）。

### F3 服务健康但 UI 探活红/"启动中…"假象
- 根因：`GET /` 无 token 返回 **401**（鉴权），启动器探活曾只认 200 → 健康服务被标 `httpOk:false`。
- 状态：v0.8.0 起探活把任何 HTTP 响应视为在线，并新增 `httpCode` 字段（401/302 属正常）。
- 判断口径：`running=true` + `httpCode∈{200,302,307,401}` 即健康。

### F4 其他已知（快速对照）
- spawn cmd ENOENT / 构建失败 → PATH 缺 System32/套件 node：v0.7.5/0.7.6 已三层加固；复现时查 `ensurePathSanity` 与 .cmd 头部。
- 中文日志乱码 → GBK 回退解码（v0.7.5+）。
- `frontend dist not built` / `bundle script failed to load` → `修复环境构建（全量）`（clean+install+build+build:web），浏览器硬刷新。
- 端口被非启动器进程占用 → 更新拒绝并提示先停止；`netstat -ano | findstr :PORT` 查 PID。
- 致命错误弹窗「尝试恢复」：更新失败→回退更新前版本+全量重建；插件失败→卸载+还原 `cordis.patch.yml`（快照在 `.dshctl/<键>/backups/lastop.json`）。

## 4. 修复主 dsh 的标准流程（更新后出问题的场景）

1. 只读取证：`GET /api/logs?tail=300`、读 `.dshctl/<键>/server.console.log`、`GET /api/status`、`GET /api/plugins`（bundle 是否含异常插件）。
2. 对照故障库定位（F1 settingsNamespace / F2 session.events / F4 各项）。
3. 需要停/启/重启主 dsh 前**先问用户**（会中断当前 GUI 会话）。
4. 修复动作可选：更新/禁用插件、`修复环境构建`、`尝试恢复`、回退版本；完成后重启并硬刷新浏览器。
5. **主端一时修不好 → 切备用端**（见下），在备用端开新会话让智能体按本 skill 继续修复主端（"vibecoding"式自我修复）。

## 5. 备用服务器（.dsh_temp）使用手册

- 结构：`.dsh_temp/dsh`=固定版本 dsh clone（含 node_modules/dist）；`.dsh_temp/.dsh`=独立 DSH_HOME（profiles/plugins/.agent-presets/skills）；`upstream/`=routing-suite 对照（可删）。
- 生命周期 API/UI：`GET /api/standby/status`；`POST /api/standby/bootstrap`（clone 固定 tag+install+build+build:web，SSE 进度）；`POST /api/standby/provision`（装 router 注入器+预设[含 0.1.3 兼容层] + sidebar@0.18 + 复制本 skill 到备用 home）；`start/stop/restart`；打开：`/api/open {target:"standbyWeb"|"standbyFolder"|"standbyLogs"}`。
- 用途：① 主端升级/插件事故后，备用端（同版本、干净插件集）提供可用的 dsh GUI/CLI 继续工作与修复；② routing-suite/预设改动先在 `upstream/` 对照测试（见 `compat-test/run.mjs` 离线回归）。
- 注意：备用端不弹致命错误窗、不参与主端 config 切换；`DSH_HOME` 恒指向独立 home，绝不与主用户数据混淆。
- **跨设备部署同版本**：新机器先部署 dsh-launcher（setup.cmd），再在「管理 dsh → 备用服务器（默认折叠）」按与正常部署相同的流程手动部署（固定 `dsh-v0.1.3-alpha.1`）+ 初始化用户目录；备用端目录不入库、不随启动器更新；若离线，用 git clone `--depth 1 --branch dsh-v0.1.3-alpha.1` 手动放 `.dsh_temp/dsh` 并 pnpm install/build，再手动把 `skills/dsh-operations` 放进独立 `.dsh` 的 `skills/` 并补 router/sidebar（tools/plugin.cmd 指向该 home 需 DSH_HOME 环境变量指向 `.dsh_temp/.dsh`）。

## 6. 工程约束与习惯

- `config.json`（含绝对路径/个人设置）与 `.dshctl/`、`.dsh_temp/` 不入库；改配置走 `POST /api/config` 或手工编辑后重启启动器生效（launcherPort 变更需重启）。
- 后端文件 UTF-8；`.cmd` 必须纯 ASCII + CRLF。
- 零依赖约束：`server/*.mjs` 只用 node: 内置模块（plugins/usage/standby 互相 import 可以）。
- 会话备份自动发生在插件变更/更新前：`.dshctl/<键>/backups/`。
- 测试：预设兼容回归 `G:\dsh-launcher\.dsh_temp\compat-test\run.mjs`、备用模块单测 `compat-test\standby-ut.mjs`（kit node 运行，离线）。
