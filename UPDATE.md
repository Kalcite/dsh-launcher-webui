# dsh-launcher 更新日志

> 原 README「更新日志」章节自 v0.8.0 起独立成文；功能/配置/运维文档见 [README.md](README.md)。


### v0.8.0 — 备用服务器（固定版本 + 独立 DSH_HOME）+ 故障登记（better-sidebar 启动即退）+ 探活修复

- **备用端入口收敛与部署自动检测**：备用端操作集成到「管理 dsh」（默认折叠的备用服务器区），部署按钮先自动检测备用本体目录（`.dsh_temp/dsh`）与关键文件——空/缺失→全新克隆固定版本，git 仓库→同步固定版本重建，非空非 git→拒绝覆盖并提示清理（另提供「重新部署/同步」）；备用端口默认 **3090**（config `standbyWebPort`，与主端口解耦）
- **更新日志独立成文**：自 README 拆分为本文件 `UPDATE.md`；文档做隐私清理（无用户名/凭据/token，路径为安装示例、用户名 `<user>` 占位），个人配置与 `.dsh_temp/` 不入库
- **故障登记（2026-09-04 续）**：dsh 更新到 0.1.3-alpha.1 后**启动即退 code=1**——旧版 `dsh-better-sidebar`（<0.18）import 已被新版 `@deepseek-ai/dsh-settings` 移除的 `settingsNamespace` → loader include 失败 → boot 中止（详见「故障记录 2026-09-04（续）」）；修复 = 插件升到 ≥0.18.0
- **最稳定组合登记**：launcher ≥0.8.0 ↔ dsh `dsh-v0.1.3-alpha.1`(d347e70) ↔ 插件 router 相关 + `dsh-better-sidebar@≥0.18.0`；跨设备部署同版本
- **备用服务器（.dsh_temp）**：固定版本 dsh 本体 + **独立 DSH_HOME**（仅 router 注入器/预设 + better-sidebar + 运维 skill），全新端点 `GET/POST /api/standby/*` + 「管理 dsh」页内**默认折叠**的备用服务器区（部署走与正常部署同一引擎、手动触发）；备用端目录不入库、不随启动器更新（详见「备用服务器（.dsh_temp）」章节）；主端升级/插件事故后启动备用端进入修复（vibecoding 式自愈）
- **运维 skill**：`.agents/skills/dsh-operations/SKILL.md`（备用端初始化自动复制到其 `skills/`，user-dsh 根即加载）
- **探活修复**：dsh web 根路径带 token 鉴权返回 401——探活改为**任意 HTTP 响应即在线**并新增 `httpCode` 字段（消除健康服务被标 httpOk:false 的"启动中…"假象）
- **用量分析适配 dsh 0.1.3**：支持 v2 持久日志 `session.v2.jsonl.zstd`（token 记账在 `assistant/message.data.usage`）与 v0 流式日志双格式；同一会话自动取最高版本文件防重复计数；迁移 `.tmp`/生成计数文件忽略（详见「用量分析」章节）
- **打开 Web UI 带 token**：主端/备用端「打开 Web UI」自动从 console 日志取 `?token=` 完整地址（401 鉴权场景直接可用）
- `.dsh_temp` 子目录化（`dsh/` 备用本体 + `.dsh/` 独立用户目录 + `upstream/` 对照 clone）并整体 gitignore；config 新增 `standbyRoot/standbyHome/standbyWebPort/standbyTag`
- 文档完善：备用端快速上手 / `dsh-operations` skill 用法 / 备用 FAQ / 用量分析数据说明章节

### v0.7.7 — routing-suite 预设安装修复（双布局探测 + dsh 0.1.3 Session API 兼容层自动落盘）

- **根因**：dsh-routing-suite 上游仓库布局已从 `preset/preset/<name>` 改为 `preset/<name>`，本启动器安装路径未跟随 → 重装 routing-suite 预设 0/2 跳过、旧代码原样保留（2026-09-04 Router 预设崩溃的诱因之一）
- **双布局探测**：按 `preset/<name>` → `preset/preset/<name>` → `<suite>/<name>` 依次查找预设源码（须含 `agent.cordis.yml`），新老布局安装均可真正落盘
- **0.1.3 兼容层自动落盘**：预设安装后自动扫描全部 `.mjs`——发现仍裸读 `session.events`（dsh 0.1.3 已移除该属性）的文件 → 注入 `sessionEvents()` 兼容读取（`.events` → `snapshotEvents()` → `ownEvents()` → `[]`）并改写调用点；改写文件逐个 `node --check`，语法失败自动回滚；上游已适配代码（router-standard v34 / router-spec v10 装载链）逐字节不动
- **覆盖安全**：替换旧预设前整体备份到 `.agent-presets/.patch-backup-<ts>/`（保留最近 3 份），手动补丁/旧版本可回退
- 配套离线回归测试：`hasBareSessionEvents` / `rewriteBareSessionEvents` / `installPresets` 单元 + 新布局 / 旧布局 / 脏旧代码合成样例共 29 断言全过（不碰线上 profile、不联网）

### v0.7.6 — 全环节 PATH 加固（spawn cmd ENOENT 根因修复 + 全面审计）

- **根因**：Windows 上 Node 的 `spawn`/`execFile` 查找可执行文件**只查 env.PATH**（没有 System32 兜底）——用户 PATH 缺 System32 时连 `cmd.exe` 都解析不到 → `spawn cmd ENOENT`，构建/更新全部失败
- **三层加固（覆盖所有环节）**：
  1. **服务器启动自愈**：`ensurePathSanity()` 修补进程自身 PATH（注入 System32 / Windows / 套件 node 目录），一次覆盖本服务器全部 spawn/execFile 点（cmd / netstat / taskkill / powershell / git / pnpm）
  2. **launcher.cmd / launcher-stop.cmd / setup.cmd**：会话开头 `PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%`，从源头保证（python / node 子进程继承）
  3. **runStream 用 cmd.exe 全路径**，双保险
- **插件管理输出 GBK 解码**：plugins.mjs 两处 tee 同步接入 UTF-8→GBK 回退（与 index.mjs 一致），中文插件输出不再乱码
- 实测：PATH 仅剩套件目录启动 → 自动注入并警告 → env/status/usage/backup 全接口正常；spawn cmd ENOENT 复现与修复均验证

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

