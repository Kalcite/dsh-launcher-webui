#!/usr/bin/env node
/**
 * dsh-launcher backend — 零依赖 Node 服务器（仅用 node: 内置模块）。
 *
 * 职责：
 *  - 管理 dsh web 服务器生命周期（start / stop / restart + HTTP 探活）
 *  - 收集 dsh 服务器输出：环形缓冲 + 落盘 .dshctl/server.console.log（与 dsh.cmd 一致）
 *  - SSE (/api/events) 实时推送日志与状态
 *  - 提供前端静态资源（生产模式 dist/）
 *
 * 配置优先级：config.json < 环境变量 (DSH_ROOT / DSH_WEB_PORT / DSH_LAUNCHER_PORT / DSH_OPEN_BROWSER) < CLI 参数
 *  CLI: --dsh-root <path> --web-port <n> --port <n> --profile <name> --open
 */
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import {
  createWriteStream,
  createReadStream,
  existsSync,
  statSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  rmSync
} from "node:fs";
import { mkdir, readdir, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import * as plugins from "./plugins.mjs";
import * as usage from "./usage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(LAUNCHER_ROOT, "dist");

/* ------------------------------ 配置 ------------------------------ */

const DEFAULT_CONFIG = {
  dshRoot: path.join(LAUNCHER_ROOT, "..", "deepseek_harness"),
  // DSH_HOME：dsh 用户数据根（profile/插件/预设/会话/凭据等）。
  // null = 不设置（dsh 默认 ~/.dsh）；可指向项目目录如 "./.dsh"（相对 dshRoot 解析）或任意绝对路径。
  dshHome: null,
  webPort: 3080,
  launcherPort: 5177,
  profile: null, // null = 默认 profile（web）；可指定如 "headless"
  openBrowser: false,
  logLines: 3000
};

function loadConfig() {
  const cfg = { ...DEFAULT_CONFIG };
  try {
    Object.assign(cfg, JSON.parse(readFileSync(path.join(LAUNCHER_ROOT, "config.json"), "utf8")));
  } catch { /* 使用默认值 */ }

  const envMap = {
    DSH_ROOT: "dshRoot",
    DSH_WEB_PORT: "webPort",
    DSH_LAUNCHER_PORT: "launcherPort",
    DSH_PROFILE: "profile",
    DSH_OPEN_BROWSER: "openBrowser"
  };
  for (const [envKey, cfgKey] of Object.entries(envMap)) {
    const v = process.env[envKey];
    if (v === undefined) continue;
    if (cfgKey === "openBrowser") cfg[cfgKey] = v === "1" || v === "true";
    else if (cfgKey.endsWith("Port")) cfg[cfgKey] = Number(v);
    else cfg[cfgKey] = v || null;
  }

  const argv = process.argv;
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  if (argv.includes("--open")) cfg.openBrowser = true;
  if (flag("--dsh-root")) cfg.dshRoot = flag("--dsh-root");
  if (flag("--dsh-home")) cfg.dshHome = flag("--dsh-home") === "default" ? null : flag("--dsh-home");
  if (flag("--web-port")) cfg.webPort = Number(flag("--web-port"));
  if (flag("--port")) cfg.launcherPort = Number(flag("--port"));
  if (flag("--profile")) cfg.profile = flag("--profile") || null;

  // dshRoot 支持相对路径：相对启动器套件根解析（便于整体打包移动，dsh 本体在独立目录）
  cfg.dshRoot = path.isAbsolute(cfg.dshRoot)
    ? path.resolve(cfg.dshRoot)
    : path.resolve(LAUNCHER_ROOT, cfg.dshRoot);

  // dshHome：绝对路径直接使用；相对路径相对 dshRoot 解析（项目目录里放 .dsh）；支持 ~ 展开
  if (cfg.dshHome) {
    cfg.dshHome = expandTilde(cfg.dshHome);
    cfg.dshHome = path.isAbsolute(cfg.dshHome)
      ? path.resolve(cfg.dshHome)
      : path.resolve(cfg.dshRoot, cfg.dshHome);
  }
  return cfg;
}

/** 展开 ~ / ~/ 前缀为用户主目录（与 dsh 的 expandHomePath 一致） */
function expandTilde(p) {
  const home = homedir();
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

const cfg = loadConfig();

// 插件管理模块的上下文（传入本后端内部函数）
const pluginCtx = {
  cfg,
  LAUNCHER_ROOT,
  pushLog,
  runStream,
  kitNodeExe,
  recordLastOp,
  lastOp: () => state.lastOp,
  backupSessions: (reason) => backupSessions(reason)
};

/* ------------------------------ 状态 ------------------------------ */

const state = {
  proc: null,       // 由本启动器拉起的 dsh 子进程
  startedAt: null,
  busy: false,      // 有启停操作在执行
  stopping: false,  // 正在人工停止（避免误判致命错误）
  log: [],          // 环形日志 [{ seq, line }]
  seq: 0,
  events: [],       // 事件记录 [{ seq, ts, level, source, message }]
  eventSeq: 0,
  lastOp: null,     // 最近一次可恢复操作快照（更新前/插件安装前）
  envCache: null,
  envCacheAt: 0
};
const sseClients = new Set();

/* ------------------------------ 启动器日志（每次启动一个文件，按启动时间命名；目录缺失自动重建） ------------------------------ */

const LAUNCHER_LOG_DIR = () => path.join(cfg.dshRoot, ".dshctl", "logs");
let launcherLogStream = null;   // 本次启动的日志文件流
let launcherLogPath = null;
let launcherLogRetryAt = 0;
let launcherLogCheckAt = 0;     // 文件存在性探测节流

function pad2(n) { return String(n).padStart(2, "0"); }

/** 初始化本次启动的日志文件（目录缺失自动重建），返回文件路径或 null */
function initLauncherLog() {
  try {
    const dir = LAUNCHER_LOG_DIR();
    mkdirSync(dir, { recursive: true });
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    launcherLogPath = path.join(dir, `launcher-${stamp}.log`);
    const s = createWriteStream(launcherLogPath, { flags: "a" });
    s.on("error", () => {
      // 磁盘异常等 → 置空，稍后由 writeLauncherLog 重建（节流）
      launcherLogStream = null;
      launcherLogRetryAt = Date.now() + 2000;
    });
    launcherLogStream = s;
    return launcherLogPath;
  } catch {
    launcherLogStream = null;
    return null;
  }
}

/** 把一行日志追加到本次启动的日志文件（目录/文件被删时自动重建） */
function writeLauncherLog(line, level, source) {
  if (!launcherLogStream || !launcherLogPath) {
    if (Date.now() < launcherLogRetryAt) return;
    if (!initLauncherLog()) { launcherLogRetryAt = Date.now() + 5000; return; }
  }
  // Windows 上删除已打开的文件不会触发 error（句柄仍可写），需主动探测存在性（2s 节流）
  if (Date.now() >= launcherLogCheckAt + 2000) {
    launcherLogCheckAt = Date.now();
    if (!existsSync(launcherLogPath)) {
      launcherLogStream = null;
      launcherLogRetryAt = 0; // 立即重建目录与文件
      initLauncherLog();
      if (!launcherLogStream) { launcherLogRetryAt = Date.now() + 5000; return; }
    }
  }
  try {
    launcherLogStream.write(`[${new Date().toISOString()}] [${level}] [${source}] ${line}\n`);
  } catch { /* 写入失败忽略，下次自动重建 */ }
}

initLauncherLog();
pushLog(`══ 启动器启动 ══（日志落盘：${launcherLogPath ?? "写入失败，仅内存缓冲"}）`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 记录一行日志 + 一条结构化事件。
 * @param {string} line 日志内容
 * @param {"info"|"warn"|"error"} level 级别：正常（启动/停止/重启等）不特意标注；
 *        警告用黄色、错误用红色标记
 * @param {string} source 来源：launcher / server / deploy / update / plugin
 */
function pushLog(line, level = "info", source = "launcher") {
  const entry = { seq: state.seq++, line, level, source };
  state.log.push(entry);
  if (state.log.length > cfg.logLines) state.log.splice(0, state.log.length - cfg.logLines);
  const ev = { seq: state.eventSeq++, ts: Date.now(), level, source, message: line };
  state.events.push(ev);
  if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000);
  broadcast({ type: "log", entry });
  broadcast({ type: "event", event: ev });
  writeLauncherLog(line, level, source); // 落盘到本次启动的日志文件（按启动时间命名）
}

/** 记录可恢复操作的快照（更新前版本 / 插件安装前配置），供「尝试恢复」使用；持久化到 .dshctl/backups/lastop.json */
function recordLastOp(kind, data) {
  state.lastOp = { kind, ts: Date.now(), data };
  try {
    const backupsDir = path.join(cfg.dshRoot, ".dshctl", "backups");
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(path.join(backupsDir, "lastop.json"), JSON.stringify(state.lastOp, null, 2), "utf8");
  } catch { /* 持久化失败不影响内存快照 */ }
  pushLog(`[launcher] 已记录可恢复快照（${kind}）`, "info", "launcher");
}

/** 启动时加载持久化的恢复快照（后端重启后仍可恢复） */
function loadLastOp() {
  try {
    const f = path.join(cfg.dshRoot, ".dshctl", "backups", "lastop.json");
    if (existsSync(f)) state.lastOp = JSON.parse(readFileSync(f, "utf8"));
  } catch { /* 无快照 */ }
}

/* ------------------------------ 会话备份（升级 dsh/插件前保护） ------------------------------ */

const backupsFile = () => path.join(cfg.dshRoot, ".dshctl", "backups", "backups.json");

function readBackups() {
  try { return JSON.parse(readFileSync(backupsFile(), "utf8")); } catch { return []; }
}

function writeBackups(list) {
  try {
    mkdirSync(path.dirname(backupsFile()), { recursive: true });
    writeFileSync(backupsFile(), JSON.stringify(list, null, 2), "utf8");
  } catch { /* 记录失败不阻断 */ }
}

/** 备份 dsh 会话数据（$DSH_HOME/sessions）到 .dshctl/backups/sessions-<ts>/，并写记录 */
function backupSessions(reason = "手动备份") {
  const home = cfg.dshHome ?? path.join(homedir(), ".dsh");
  const src = path.join(home, "sessions");
  const id = `sessions-${Date.now()}`;
  const target = path.join(cfg.dshRoot, ".dshctl", "backups", id);
  try {
    if (!existsSync(src)) {
      pushLog(`[backup] ⚠ 未找到会话目录 ${src}，跳过备份（仍记录）`, "warn", "launcher");
      writeBackups([...readBackups(), { id, ts: Date.now(), reason, source: src, target, size: 0, files: 0, skipped: true }]);
      return { ok: true, id, skipped: true };
    }
    cpSync(src, target, { recursive: true });
    let size = 0, files = 0;
    for (const f of readdirSync(target, { recursive: true })) {
      const full = path.join(target, f);
      if (statSyncSafe(full)?.isFile()) { size += statSync(full).size; files++; }
    }
    writeBackups([...readBackups(), { id, ts: Date.now(), reason, source: src, target, size, files }]);
    pushLog(`[backup] 已备份会话 → ${target}（${files} 文件 / ${(size / 1024).toFixed(1)} KB，原因：${reason}）`);
    return { ok: true, id, files, size };
  } catch (e) {
    pushLog(`[backup] 备份失败: ${e?.message ?? e}`, "error", "launcher");
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** 删除备份记录与目录 */
function deleteBackup(id) {
  const list = readBackups();
  const item = list.find((b) => b.id === id);
  if (!item) return { ok: false, error: "备份记录不存在" };
  try {
    if (!item.skipped && existsSync(item.target)) rmSync(item.target, { recursive: true, force: true });
  } catch (e) {
    return { ok: false, error: `删除目录失败: ${e?.message ?? e}` };
  }
  writeBackups(list.filter((b) => b.id !== id));
  pushLog(`[backup] 已删除备份 ${id}（原因：${item.reason}）`);
  return { ok: true };
}

/** 广播致命错误（前端弹窗：查看日志 / 尝试恢复） */
function broadcastFatal(kind, message) {
  const payload = { type: "fatal", kind, message, recoverable: kind === "update" || kind === "plugin" };
  broadcast(payload);
  pushLog(`[fatal] ${message}`, "error", kind === "update" ? "update" : kind === "plugin" ? "plugin" : "server");
}

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { /* 客户端已断，忽略 */ }
  }
}

/* ------------------------------ 小工具 ------------------------------ */

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 8000, windowsHide: true, encoding: "utf8" }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || "").trim() });
    });
  });
}

function openUrl(url) {
  execFile("cmd", ["/c", "start", "", url], { windowsHide: true, detached: true }, () => {});
}

/** 列出监听某端口的 PID（netstat 解析，兼容 Windows） */
function portPids(port) {
  return new Promise((resolve) => {
    execFile("netstat", ["-ano"], { windowsHide: true, encoding: "utf8" }, (err, stdout) => {
      if (err) return resolve([]);
      const re = new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
      const pids = new Set();
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.match(re);
        if (m && m[1] !== "0") pids.add(Number(m[1]));
      }
      resolve([...pids]);
    });
  });
}

function killTree(pid) {
  return new Promise((resolve) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  });
}

function probeHttp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2500 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

/* ------------------------------ 部署工具（一键部署 dsh 到独立目录） ------------------------------ */

const HARNESS_URL = "https://github.com/deepseek-ai/deepseek-harness.git";
const KIT_NODE_DIR = path.join(LAUNCHER_ROOT, ".runtime", "node");
const KIT_NODE_EXE = path.join(KIT_NODE_DIR, "node.exe");
const KIT_PNPM = path.join(KIT_NODE_DIR, "pnpm.cmd");

function kitNodeExe() {
  return existsSync(KIT_NODE_EXE) ? KIT_NODE_EXE : process.execPath;
}
function kitPnpmCmd() {
  return existsSync(KIT_PNPM) ? KIT_PNPM : null;
}

/** 流式执行命令：输出逐行进 pushLog（→ 环形缓冲 + SSE），返回 { code } */
function runStream(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    pushLog(`[deploy] $ ${cmd} ${args.join(" ")}`);
    const proc = spawn(cmd, args, {
      cwd: opts.cwd ?? LAUNCHER_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env
    });
    const tee = (chunk, prefix) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) pushLog(prefix ? `${prefix} ${line}` : line);
      }
    };
    proc.stdout.on("data", (d) => tee(d, ""));
    proc.stderr.on("data", (d) => tee(d, "[stderr]"));
    proc.on("error", (err) => {
      pushLog(`[deploy] 命令启动失败: ${err.message}`);
      resolve({ code: -1 });
    });
    proc.on("exit", (code) => resolve({ code }));
  });
}

/** 解析目标的 git 默认分支（main / master） */
async function detectBranch(root) {
  const r = await run("git", ["-C", root, "branch", "-r"]);
  if (r.ok && /origin\/main/.test(r.out)) return "main";
  return "master";
}

async function deployStatus(root) {
  const out = {
    dshRoot: root,
    exists: existsSync(root),
    isGitRepo: existsSync(path.join(root, ".git")),
    gitBranch: null,
    gitCommit: null,
    pkgVersion: null,
    hasNodeModules: existsSync(path.join(root, "node_modules")),
    hasWebDist: existsSync(path.join(root, "apps", "web", "dist")),
    hasBuildMarkers: existsSync(path.join(root, "tsconfig.host.tsbuildinfo")) && existsSync(path.join(root, "tsconfig.client.tsbuildinfo")),
    entryOk: existsSync(path.join(root, "apps", "cli", "src", "bin.ts")),
    deployed: false
  };
  if (out.isGitRepo) {
    const [b, c] = await Promise.all([
      run("git", ["-C", root, "branch", "--show-current"]),
      run("git", ["-C", root, "rev-parse", "--short", "HEAD"])
    ]);
    out.gitBranch = b.ok ? b.out : null;
    out.gitCommit = c.ok ? c.out : null;
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    out.pkgVersion = pkg.version ?? null;
  } catch { /* 不是 dsh 仓库 */ }
  out.deployed = out.isGitRepo && out.hasNodeModules && out.entryOk;
  return out;
}

async function ensureGitRepo(root) {
  if (existsSync(path.join(root, ".git"))) {
    pushLog(`[deploy] 目录已是 git 仓库，同步远端 (git fetch + checkout)`);
    await runStream("git", ["-C", root, "fetch", "origin"], { cwd: root });
    const branch = await detectBranch(root);
    const r = await runStream("git", ["-C", root, "checkout", "-B", branch, `origin/${branch}`, "-f"], { cwd: root });
    return r.code === 0;
  }
  // 目标目录已存在且非空 → 拒绝（git clone 无法覆盖非空目录）
  if (existsSync(root)) {
    const items = await readdir(root).catch(() => []);
    if (items.length > 0) {
      pushLog(`[deploy] 目标目录 ${root} 非空且不是 git 仓库，请更换目录`);
      return false;
    }
  }
  pushLog(`[deploy] git clone --depth 1 ${HARNESS_URL} → ${root}`);
  const r = await runStream("git", ["clone", "--depth", "1", HARNESS_URL, root], { cwd: path.dirname(root) });
  return r.code === 0;
}

async function deployDsh(opts = {}) {
  const target = opts.targetDir ? path.resolve(LAUNCHER_ROOT, opts.targetDir) : cfg.dshRoot;
  const skipBuild = !!opts.skipBuild;
  pushLog(`[deploy] ══ 开始一键部署 dsh → ${target} ══`);
  if (state.busy) return { ok: false, error: "已有操作在执行，请稍候" };
  state.busy = true;
  try {
    // 1) git
    const gitOk = await ensureGitRepo(target);
    if (!gitOk) return { ok: false, error: "git 同步失败，请查看日志" };

    // 2) pnpm install（优先套件便携 pnpm，缺省用 cmd 里的 pnpm）
    pushLog("[deploy] 安装依赖 (pnpm install)…");
    const pnpm = kitPnpmCmd();
    let code;
    if (pnpm) code = (await runStream("cmd", ["/c", pnpm, "install"], { cwd: target })).code;
    else code = (await runStream("cmd", ["/c", "pnpm install"], { cwd: target })).code;
    if (code !== 0) return { ok: false, error: `pnpm install 失败 (exit ${code})` };

    // 3) build（可跳过）
    if (!skipBuild) {
      pushLog("[deploy] 构建 (pnpm run build)…");
      if (pnpm) code = (await runStream("cmd", ["/c", pnpm, "run", "build"], { cwd: target })).code;
      else code = (await runStream("cmd", ["/c", "pnpm run build"], { cwd: target })).code;
      if (code !== 0) return { ok: false, error: `pnpm run build 失败 (exit ${code})` };
      // 根 build 不产出前端 dist；web-app bundle 启动强制要求 → 缺失补跑 build:web
      const webCode = await ensureWebDist(target, pnpm, "deploy");
      if (webCode !== 0) return { ok: false, error: `pnpm run build:web 失败 (exit ${webCode})` };
    }

    // 4) 部署成功 → 切换配置指向新目录
    cfg.dshRoot = target;
    state.envCache = null;
    persistConfig();
    pushLog(`[deploy] ══ 部署完成 → ${target} ══`);
    return { ok: true, target, status: await deployStatus(target) };
  } finally {
    state.busy = false;
  }
}

/** 检查更新：本地版本信息 + 同步 GitHub releases（含更新内容） */
/** 简单版本比较：纯数字点分（0.4.3 vs 0.4.10） */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 检查启动器自身更新（对比本仓库 GitHub Releases 最新版） */
async function launcherCheck() {
  let current = "?";
  try {
    current = JSON.parse(readFileSync(path.join(LAUNCHER_ROOT, "package.json"), "utf8")).version;
  } catch { /* 保持 ? */ }
  // 安装模式：git clone（可 git pull） vs 下载 zip 构建（无 .git，需下载源码包更新）
  const mode = existsSync(path.join(LAUNCHER_ROOT, ".git")) ? "git" : "zip";
  let latest = null, error = null;
  try {
    const res = await fetch("https://api.github.com/repos/Kalcite/dsh-launcher-webui/releases/latest", {
      headers: { "User-Agent": "dsh-launcher" }, signal: AbortSignal.timeout(12000)
    });
    if (res.ok) {
      const r = await res.json();
      latest = { tag: r.tag_name, name: r.name, publishedAt: r.published_at, body: (r.body ?? "").slice(0, 3000) };
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    error = String(e?.message ?? e);
  }
  const hasUpdate = latest ? compareVersions(current, latest.tag.replace(/^v/, "")) < 0 : false;
  return { current, latest, hasUpdate, error, repo: "Kalcite/dsh-launcher-webui", mode };
}

/**
 * zip 模式更新（无 .git 的下载 zip 构建）：
 * 1) 下载最新版 GitHub 源码包（refs/tags/<tag>.zip）
 * 2) Windows 自带 tar(bsdtar) 解压到 .dshctl/update-stage-* 
 * 3) 在新源码目录执行 pnpm install + pnpm run build（产出全新 dist/node_modules）
 * 4) 整体替换启动器目录，保留 config.json / .dshctl（用户数据）/ .runtime（内置 node）
 * 5) 写 .update-pending 重启标记
 */
async function launcherUpdateZip(env) {
  const chk = await launcherCheck();
  if (chk.error) return { ok: false, error: `获取最新版本失败: ${chk.error}` };
  if (!chk.latest) return { ok: false, error: "未获取到可用版本" };
  const tag = chk.latest.tag;
  if (chk.current !== "?" && compareVersions(chk.current, tag.replace(/^v/, "")) >= 0) {
    return { ok: false, error: `已是最新版本（v${chk.current}）` };
  }
  const stage = path.join(LAUNCHER_ROOT, ".dshctl", `update-stage-${Date.now()}`);
  try {
    mkdirSync(stage, { recursive: true });
    const zipPath = path.join(stage, "src.zip");
    pushLog(`[launcher] zip 模式：下载 ${tag} 源码包…`);
    const res = await fetch(`https://github.com/Kalcite/dsh-launcher-webui/archive/refs/tags/${tag}.zip`, {
      headers: { "User-Agent": "dsh-launcher" }, signal: AbortSignal.timeout(180000)
    });
    if (!res.ok) return { ok: false, error: `下载源码包失败 HTTP ${res.status}` };
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    pushLog(`[launcher] zip 模式：解压源码包（${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB）…`);
    // Windows 10+ 自带 bsdtar（System32\tar.exe），支持 zip；优先用全路径，兜底 PATH 里的 tar
    const sysTar = path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");
    const tarExe = existsSync(sysTar) ? sysTar : "tar";
    const ex = await runStream(tarExe, ["-xf", zipPath, "-C", stage], { cwd: stage, env });
    if (ex.code !== 0) return { ok: false, error: "解压失败（需要 Windows 10+ 自带 tar，或系统 tar 在 PATH）" };
    // 定位顶层目录（GitHub zip 顶层为 dsh-launcher-webui-<tag>/）
    const inner = readdirSync(stage)
      .map((n) => path.join(stage, n))
      .find((p) => statSync(p).isDirectory() && path.basename(p) !== ".dshctl");
    if (!inner || !existsSync(path.join(inner, "package.json"))) {
      return { ok: false, error: "源码包结构异常（缺少 package.json）" };
    }
    pushLog("[launcher] zip 模式：安装依赖（pnpm install）…");
    let r = kitPnpmCmd()
      ? await runStream("cmd", ["/c", kitPnpmCmd(), "install"], { cwd: inner, env })
      : await runStream("cmd", ["/c", "pnpm install"], { cwd: inner, env });
    if (r.code !== 0) return { ok: false, error: `pnpm install 失败 (exit ${r.code})` };
    pushLog("[launcher] zip 模式：构建前端（pnpm run build）…");
    r = kitPnpmCmd()
      ? await runStream("cmd", ["/c", kitPnpmCmd(), "run", "build"], { cwd: inner, env })
      : await runStream("cmd", ["/c", "pnpm run build"], { cwd: inner, env });
    if (r.code !== 0) return { ok: false, error: `pnpm run build 失败 (exit ${r.code})` };
    // 整体替换（保留用户数据与内置运行时）
    pushLog("[launcher] zip 模式：替换启动器文件（保留 config.json / .dshctl / .runtime）…");
    const keep = new Set(["config.json", ".dshctl", ".runtime"]);
    for (const name of readdirSync(LAUNCHER_ROOT)) {
      if (keep.has(name)) continue;
      rmSync(path.join(LAUNCHER_ROOT, name), { recursive: true, force: true });
    }
    for (const name of readdirSync(inner)) {
      if (keep.has(name)) continue;
      cpSync(path.join(inner, name), path.join(LAUNCHER_ROOT, name), { recursive: true });
    }
    writeFileSync(path.join(LAUNCHER_ROOT, ".update-pending"),
      JSON.stringify({ ts: Date.now(), phase: 1, mode: "zip", message: "基本更新完成，重启后完成剩余更新" }), "utf8");
    pushLog(`[launcher] ══ zip 模式更新完成（${tag}），请重启启动器 ══`);
    return { ok: true, phase: 1, mode: "zip", message: `更新完成（${tag}），重启启动器后生效` };
  } catch (e) {
    return { ok: false, error: `zip 更新失败: ${e?.message ?? e}` };
  } finally {
    try { rmSync(stage, { recursive: true, force: true }); } catch { /* 清理失败忽略 */ }
  }
}

/**
 * 启动器更新（分步，不中断当前进程）：
 * git 模式：确保在分支上（detached HEAD 自动切回 master）→ git pull --ff-only → install → build → 重启标记
 * zip 模式（无 .git）：下载源码包 → install/build → 整体替换 → 重启标记
 */
async function launcherUpdate() {
  if (state.busy) return { ok: false, error: "已有操作在执行，请稍候" };
  pushLog("[launcher] ══ 启动器更新（分步：不中断当前进程）══");
  state.busy = true;
  try {
    // CI=true 跳过 pnpm 的 deps 状态检查（避免 version/lockfile 短暂不一致时卡住）
    const pnpmEnv = { ...process.env, CI: "true" };
    const pnpm = kitPnpmCmd();
    const isGit = existsSync(path.join(LAUNCHER_ROOT, ".git"));

    if (!isGit) {
      pushLog("[launcher] 检测到 zip 安装（无 .git），走源码包下载更新…");
      const zr = await launcherUpdateZip(pnpmEnv);
      return zr.ok ? { ok: true, ...zr } : zr;
    }

    // ── git 模式：确保当前在分支上（兼容 detached HEAD / 标签检出） ──
    const br = await run("git", ["-C", LAUNCHER_ROOT, "branch", "--show-current"]);
    if (!br.ok || !br.out) {
      pushLog("[launcher] 当前不在分支上（detached HEAD），尝试切回 master 跟踪 origin/master…");
      const f = await run("git", ["-C", LAUNCHER_ROOT, "fetch", "origin"], { timeout: 60000 });
      if (!f.ok) return { ok: false, error: `git fetch 失败: ${f.out || "网络错误"}` };
      const anc = await run("git", ["-C", LAUNCHER_ROOT, "merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD"]);
      if (!anc.ok) {
        return { ok: false, error: "本地存在与远程分叉的提交（可能是手动改动），为安全起见请手动处理 git 状态后再更新" };
      }
      const co = await run("git", ["-C", LAUNCHER_ROOT, "checkout", "-B", "master", "FETCH_HEAD"]);
      if (!co.ok) return { ok: false, error: `无法切回 master 分支: ${co.out}` };
      // 补上游追踪（best-effort），方便后续命令行 git pull；失败不影响更新
      await run("git", ["-C", LAUNCHER_ROOT, "branch", "--set-upstream-to=origin/master", "master"]);
      pushLog("[launcher] 已切回 master 分支");
    }
    // 1) git pull（显式 origin master：兼容刚切回、暂无上游追踪的分支）
    pushLog("[launcher] 步骤 1/4: git pull --ff-only origin master…");
    let r = await runStream("git", ["-C", LAUNCHER_ROOT, "pull", "--ff-only", "origin", "master"], { cwd: LAUNCHER_ROOT, env: pnpmEnv });
    if (r.code !== 0) return { ok: false, error: "git pull 失败（工作区可能有未提交改动，请先提交或还原）" };
    // 2) pnpm install
    pushLog("[launcher] 步骤 2/4: pnpm install…");
    r = pnpm
      ? await runStream("cmd", ["/c", pnpm, "install"], { cwd: LAUNCHER_ROOT, env: pnpmEnv })
      : await runStream("cmd", ["/c", "pnpm install"], { cwd: LAUNCHER_ROOT, env: pnpmEnv });
    if (r.code !== 0) return { ok: false, error: `pnpm install 失败 (exit ${r.code})` };
    // 3) pnpm build
    pushLog("[launcher] 步骤 3/4: pnpm run build（重建前端，即时生效）…");
    r = pnpm
      ? await runStream("cmd", ["/c", pnpm, "run", "build"], { cwd: LAUNCHER_ROOT, env: pnpmEnv })
      : await runStream("cmd", ["/c", "pnpm run build"], { cwd: LAUNCHER_ROOT, env: pnpmEnv });
    if (r.code !== 0) return { ok: false, error: `pnpm run build 失败 (exit ${r.code})` };
    // 4) 重启标记
    pushLog("[launcher] 步骤 4/4: 写入重启标记 .update-pending…");
    try {
      writeFileSync(path.join(LAUNCHER_ROOT, ".update-pending"),
        JSON.stringify({ ts: Date.now(), phase: 1, message: "基本更新完成，重启后完成剩余更新" }), "utf8");
    } catch (e) {
      return { ok: false, error: `写入重启标记失败: ${e?.message ?? e}` };
    }
    pushLog("[launcher] ══ 基本更新完成 ══（当前进程未受影响；前端更新已即时生效）");
    pushLog("[launcher] 请重启启动器完成剩余更新（launcher.cmd 启动时会自动收尾并清除标记）");
    return { ok: true, phase: 1, message: "基本更新完成，重启启动器后完成剩余更新" };
  } finally {
    state.busy = false;
  }
}

async function updateCheck() {
  const root = cfg.dshRoot;
  const out = {
    dshRoot: root,
    current: { pkgVersion: null, branch: null, commit: null, tag: null },
    clientBundles: { total: 0, missing: [] },
    releases: [],
    error: null
  };
  out.clientBundles = checkClientBundles(root);
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    out.current.pkgVersion = pkg.version ?? null;
  } catch { /* 非 dsh 仓库 */ }
  const [b, c, t] = await Promise.all([
    run("git", ["-C", root, "branch", "--show-current"]),
    run("git", ["-C", root, "rev-parse", "--short", "HEAD"]),
    run("git", ["-C", root, "describe", "--tags", "--abbrev=0"])
  ]);
  out.current.branch = b.ok ? b.out : null;
  out.current.commit = c.ok ? c.out : null;
  out.current.tag = t.ok ? t.out : null;

  // 同步 GitHub releases（按发布时间倒序，含更新内容 body）
  try {
    const res = await fetch(
      "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=15",
      { headers: { "User-Agent": "dsh-launcher", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(12000) }
    );
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      out.releases = data
        .filter((r) => !r.draft)
        .map((r) => ({
          tag: r.tag_name,
          name: r.name || r.tag_name,
          publishedAt: r.published_at,
          prerelease: !!r.prerelease,
          body: String(r.body || "").slice(0, 6000)
        }));
    }
  } catch (e) {
    out.error = String(e?.message ?? e);
  }
  return out;
}

/** 全量清理（移除所有 lib/ 与 tsbuildinfo，强制一致重建；版本切换后必须执行） */
async function runClean(root) {
  const pnpm = kitPnpmCmd();
  pushLog("[update] pnpm run clean（清除增量构建缓存与旧产物）…");
  const code = pnpm
    ? (await runStream("cmd", ["/c", pnpm, "run", "clean"], { cwd: root })).code
    : (await runStream("cmd", ["/c", "pnpm run clean"], { cwd: root })).code;
  return code;
}

/**
 * 确保 dsh 前端 dist 存在：根目录 `pnpm run build` 不产出 apps/web/dist，
 * 而 web-app bundle 启动时强制 require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')，
 * 缺失会报 "web-app: frontend dist not built" 导致 dsh 无法启动 → 缺失时补跑 pnpm run build:web。
 * @returns {Promise<number>} 0=就绪
 */
async function ensureWebDist(root, pnpm, tag = "update") {
  const webDist = path.join(root, "apps", "web", "dist", "index.html");
  if (existsSync(webDist)) return 0;
  pushLog(`[${tag}] 前端 dist 缺失（apps/web/dist），补跑 pnpm run build:web…`);
  const code = pnpm
    ? (await runStream("cmd", ["/c", pnpm, "run", "build:web"], { cwd: root })).code
    : (await runStream("cmd", ["/c", "pnpm run build:web"], { cwd: root })).code;
  if (code !== 0) pushLog(`[${tag}] ⚠ pnpm run build:web 失败 (exit ${code})`, "warn", tag);
  return code;
}

/**
 * 客户端 bundle 健康检查：扫描声明了 dsh.client 的包，核对 lib/client.js 是否存在。
 * 缺失的 bundle 会导致浏览器端 "bundle script ... failed to load"。
 */
function checkClientBundles(root) {
  const missing = [];
  let total = 0;
  // web-app bundle 启动时强制 require 前端 dist；缺失会导致 "web-app: frontend dist not built"
  const webDist = path.join(root, "apps", "web", "dist", "index.html");
  if (!existsSync(webDist)) {
    total++;
    missing.push({ name: "@deepseek-ai/dsh-web-app（前端 dist）", path: webDist });
  }
  const scanDirs = [path.join(root, "packages")];
  for (const base of scanDirs) {
    if (!existsSync(base)) continue;
    let entries = [];
    try { entries = readdirSync(base); } catch { continue; }
    for (const group of entries) {
      const groupDir = path.join(base, group);
      if (!statSyncSafe(groupDir)?.isDirectory()) continue;
      let pkgs = [];
      try { pkgs = readdirSync(groupDir); } catch { continue; }
      for (const pkg of pkgs) {
        const pkgDir = path.join(groupDir, pkg);
        const pkgJson = path.join(pkgDir, "package.json");
        if (!existsSync(pkgJson)) continue;
        let manifest = null;
        try { manifest = JSON.parse(readFileSync(pkgJson, "utf8")); } catch { continue; }
        const decl = manifest?.dsh?.client;
        if (!decl || !decl.platform) continue;
        total++;
        const clientPath = path.join(pkgDir, "lib", "client.js");
        if (!existsSync(clientPath)) missing.push({ name: manifest.name ?? pkg, path: clientPath });
      }
    }
  }
  return { total, missing };
}

function statSyncSafe(p) {
  try { return statSync(p); } catch { return null; }
}

/** 安装依赖 → （可选）清理 → 构建 → 客户端 bundle 校验，返回 { code, health } */
async function installBuildVerify(root, { clean = false, skipBuild = false } = {}) {
  const pnpm = kitPnpmCmd();
  pushLog("[update] pnpm install…");
  let code = pnpm
    ? (await runStream("cmd", ["/c", pnpm, "install"], { cwd: root })).code
    : (await runStream("cmd", ["/c", "pnpm install"], { cwd: root })).code;
  if (code !== 0) return { code, error: `pnpm install 失败 (exit ${code})` };

  if (clean && !skipBuild) {
    const cleanCode = await runClean(root);
    if (cleanCode !== 0) return { code: cleanCode, error: `pnpm run clean 失败 (exit ${cleanCode})` };
  }

  if (!skipBuild) {
    pushLog("[update] pnpm run build（全量重建，消除版本切换残留）…");
    code = pnpm
      ? (await runStream("cmd", ["/c", pnpm, "run", "build"], { cwd: root })).code
      : (await runStream("cmd", ["/c", "pnpm run build"], { cwd: root })).code;
    if (code !== 0) return { code, error: `pnpm run build 失败 (exit ${code})` };
    // 根 build 不产出前端 dist；web-app bundle 启动强制要求 → 缺失补跑 build:web
    const webCode = await ensureWebDist(root, pnpm);
    if (webCode !== 0) return { code: webCode, error: `pnpm run build:web 失败 (exit ${webCode})` };
  }

  const health = checkClientBundles(root);
  if (health.missing.length > 0) {
    pushLog(`[update] ⚠ 客户端 bundle 缺失 ${health.missing.length}/${health.total} 个：`);
    for (const m of health.missing) pushLog(`[update]    - ${m.name} → ${m.path}`);
    pushLog("[update] 可点击「修复客户端构建」重试（clean + 全量重建）");
  } else {
    pushLog(`[update] 客户端 bundle 完整（${health.total} 个）`);
  }
  return { code: 0, health };
}

async function updateDsh(opts = {}) {
  const skipBuild = !!opts.skipBuild;
  const root = cfg.dshRoot;
  const version = opts.version ? String(opts.version).trim() : null;
  pushLog(`[update] ══ 更新 dsh → ${root}${version ? `（指定版本 ${version}）` : "（最新 master）"} ══`);
  if (state.busy) return { ok: false, error: "已有操作在执行，请稍候" };
  if (!existsSync(path.join(root, ".git"))) {
    return { ok: false, error: `${root} 不是 git 仓库，无法更新` };
  }

  // 0) 更新前安全：端口被非本启动器进程占用 → 拒绝；是本启动器管理的服务器 → 自动停止
  const busyPids = await portPids(cfg.webPort);
  if (busyPids.length > 0 && !state.proc) {
    return { ok: false, error: `端口 ${cfg.webPort} 正被其他进程占用（PID ${busyPids.join(",")}），请先停止 dsh 服务器再更新` };
  }
  if (state.proc) {
    pushLog("[update] 检测到运行中的 dsh 服务器，自动停止…");
    await stopServer();
  }

  // 记录恢复快照：更新前的版本/提交（供「尝试恢复到修改前」）
  const [prevTagR, prevCommitR] = await Promise.all([
    run("git", ["-C", root, "describe", "--tags", "--abbrev=0"]),
    run("git", ["-C", root, "rev-parse", "HEAD"])
  ]);
  recordLastOp("update", {
    prevTag: prevTagR.ok ? prevTagR.out : null,
    prevCommit: prevCommitR.ok ? prevCommitR.out : null
  });
  // 升级前自动备份会话数据（保护会话）
  backupSessions(`dsh 升级前自动备份（${version ?? "最新"}）`);

  state.busy = true;
  try {
    // 1) git：指定版本 → fetch tag + checkout；未指定 → 最新 master
    if (version) {
      const cur = await run("git", ["-C", root, "describe", "--tags", "--abbrev=0"]);
      if (cur.ok && cur.out.trim() === version) {
        pushLog(`[update] 当前已是版本 ${version}，跳过 git 操作`);
      } else {
        pushLog(`[update] git fetch tag ${version} …`);
        let r = await runStream("git", ["-C", root, "fetch", "origin", "--depth", "1", "tag", version], { cwd: root });
        if (r.code !== 0) {
          pushLog("[update] 浅获取失败，回退为完整 fetch --tags");
          r = await runStream("git", ["-C", root, "fetch", "origin", "--tags"], { cwd: root });
        }
        if (r.code !== 0) return { ok: false, error: "git fetch 标签失败，请检查版本号" };
        r = await runStream("git", ["-C", root, "checkout", "-B", "master", version, "-f"], { cwd: root });
        if (r.code !== 0) return { ok: false, error: "git checkout 失败" };
        pushLog(`[update] 已切换到 ${version}`);
      }
    } else {
      pushLog("[update] git pull --ff-only…");
      let r = await runStream("git", ["-C", root, "pull", "--ff-only"], { cwd: root });
      if (r.code !== 0) {
        pushLog("[update] 快速合并失败，回退为 fetch + checkout -f");
        await runStream("git", ["-C", root, "fetch", "origin"], { cwd: root });
        const branch = await detectBranch(root);
        r = await runStream("git", ["-C", root, "checkout", "-B", branch, `origin/${branch}`, "-f"], { cwd: root });
        if (r.code !== 0) return { ok: false, error: "git 更新失败" };
      }
    }

    // 2) install → clean → 全量 build → 校验（版本切换后强制 clean，消除增量/残留）
    const { code, error, health } = await installBuildVerify(root, { clean: true, skipBuild });
    if (code !== 0) return { ok: false, error };

    state.envCache = null;
    pushLog("[update] ══ 更新完成 ══（运行 dsh 请点击「启动」；浏览器若显示旧页面请硬刷新 Ctrl+Shift+R）");
    // 升级后跑一遍常用流程确认插件兼容性：自动启动 dsh → HTTP 探活 → 停止
    // （先释放 busy，避免 startServer 被"已有操作在执行"拒绝）
    state.busy = false;
    pushLog("[update] 升级后兼容性验证：自动启动 dsh 并探活…");
    let compat = { ok: false, httpOk: false };
    try {
      const start = await startServer();
      if (start.ok) {
        // dsh 冷启动约 25-35s，探活窗口放宽到 60s
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          await sleep(2000);
          const st = await serverStatus();
          if (st.httpOk) { compat.httpOk = true; break; }
        }
        await stopServer();
      }
    } catch { /* 验证失败不阻断 */ }
    compat.ok = compat.httpOk;
    if (compat.ok) pushLog("[update] 兼容性验证通过（dsh 正常启动响应）");
    else pushLog("[update] ⚠ 兼容性验证未通过（dsh 未能正常响应，可查看日志/事件管理器或尝试恢复）", "warn", "update");
    return { ok: true, version: version ?? "latest", health: health ?? { total: 0, missing: [] }, compat, status: await deployStatus(root) };
  } finally {
    state.busy = false;
  }
}

/** 恢复更新造成的错误：回退到更新前版本 + 全量重建 + 校验 */
async function recoverUpdate() {
  const op = state.lastOp;
  if (!op || op.kind !== "update") return { ok: false, error: "没有可恢复的更新快照" };
  const root = cfg.dshRoot;
  const target = op.data.prevTag || op.data.prevCommit;
  if (!target) return { ok: false, error: "缺少更新前版本记录" };
  const busyPids = await portPids(cfg.webPort);
  if (busyPids.length > 0 && !state.proc) {
    return { ok: false, error: `端口 ${cfg.webPort} 正被其他进程占用（PID ${busyPids.join(",")}），请先停止 dsh 服务器再恢复` };
  }
  if (state.proc) {
    pushLog("[recover] 检测到运行中的 dsh 服务器，自动停止…");
    await stopServer();
  }
  state.busy = true;
  try {
    pushLog(`[recover] ══ 恢复到更新前版本：${target} ══`);
    let r = await runStream("git", ["-C", root, "checkout", "-B", "master", target, "-f"], { cwd: root });
    if (r.code !== 0) {
      // 浅克隆可能缺旧提交 → 先 fetch 再回退
      await runStream("git", ["-C", root, "fetch", "origin", "--unshallow"], { cwd: root }).catch(() => {});
      r = await runStream("git", ["-C", root, "checkout", "-B", "master", target, "-f"], { cwd: root });
    }
    if (r.code !== 0) return { ok: false, error: "git 回退失败，请检查版本记录" };
    const { code, error, health } = await installBuildVerify(root, { clean: true, skipBuild: false });
    if (code !== 0) return { ok: false, error };
    state.envCache = null;
    const status = await deployStatus(root);
    pushLog(`[recover] ══ 恢复完成：版本 ${status.pkgVersion ?? target}，客户端 bundle ${health?.total ?? 0} 个 ${health?.missing?.length ? `缺失 ${health.missing.length}` : "完整"} ══`, health?.missing?.length ? "warn" : "info");
    return { ok: true, status, health: health ?? { total: 0, missing: [] } };
  } finally {
    state.busy = false;
  }
}

/** 修复客户端构建：不碰 git，clean + 全量重建 + 校验（解决 bundle script failed to load） */
async function repairDsh() {
  const root = cfg.dshRoot;
  pushLog(`[update] ══ 修复客户端构建 → ${root} ══`);
  if (state.busy) return { ok: false, error: "已有操作在执行，请稍候" };
  if (!existsSync(path.join(root, "package.json"))) {
    return { ok: false, error: `${root} 不是有效的 dsh 仓库` };
  }
  const busyPids = await portPids(cfg.webPort);
  if (busyPids.length > 0 && !state.proc) {
    return { ok: false, error: `端口 ${cfg.webPort} 正被其他进程占用（PID ${busyPids.join(",")}），请先停止 dsh 服务器再修复` };
  }
  if (state.proc) {
    pushLog("[update] 检测到运行中的 dsh 服务器，自动停止…");
    await stopServer();
  }
  state.busy = true;
  try {
    const { code, error, health } = await installBuildVerify(root, { clean: true, skipBuild: false });
    if (code !== 0) return { ok: false, error };
    state.envCache = null;
    pushLog("[update] ══ 修复完成 ══（运行 dsh 请点击「启动」）");
    return { ok: true, health: health ?? { total: 0, missing: [] }, status: await deployStatus(root) };
  } finally {
    state.busy = false;
  }
}

function persistConfig() {
  try {
    const payload = {
      dshRoot: cfg.dshRoot,
      dshHome: cfg.dshHome,
      webPort: cfg.webPort,
      launcherPort: cfg.launcherPort,
      profile: cfg.profile,
      openBrowser: cfg.openBrowser,
      pricing: cfg.pricing
    };
    writeFileSync(path.join(LAUNCHER_ROOT, "config.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
    pushLog(`[launcher] 配置已保存 → config.json (dshRoot: ${cfg.dshRoot})`);
  } catch (err) {
    pushLog(`[launcher] 配置保存失败: ${err.message}`);
  }
}

async function envInfo() {
  const now = Date.now();
  if (state.envCache && now - state.envCacheAt < 8000) return state.envCache;
  const [node, pnpm, git, lc] = await Promise.all([
    run(process.execPath, ["--version"]),
    // Windows 上 pnpm 是 .ps1/.cmd shim，execFile 无法直接执行 → 用 cmd /c 包装
    run("cmd", ["/c", "pnpm --version"]),
    run("git", ["--version"]),
    // 启动器自身版本与提交号（左下角信息栏）
    run("git", ["-C", LAUNCHER_ROOT, "rev-parse", "--short", "HEAD"])
  ]);
  let launcherVersion = "?";
  try {
    launcherVersion = JSON.parse(readFileSync(path.join(LAUNCHER_ROOT, "package.json"), "utf8")).version;
  } catch { /* 缺失时保持 ? */ }
  let portableNode = null;
  // 优先套件自带的便携 Node，其次 dsh 部署目录的便携 Node
  for (const exe of [KIT_NODE_EXE, path.join(cfg.dshRoot, ".runtime", "node", "node.exe")]) {
    if (existsSync(exe)) {
      const r = await run(exe, ["--version"]);
      if (r.ok) { portableNode = r.out; break; }
    }
  }
  state.envCache = {
    node: node.out || "?",
    pnpm: pnpm.out || "?",
    git: git.out || "?",
    portableNode,
    launcherVersion,
    launcherCommit: lc.ok ? lc.out : null,
    dshRoot: cfg.dshRoot,
    dshHome: cfg.dshHome, // null = 默认 ~/.dsh
    webPort: cfg.webPort,
    launcherPort: cfg.launcherPort,
    profile: cfg.profile
  };
  state.envCacheAt = now;
  return state.envCache;
}

/* ------------------------------ 服务器管理 ------------------------------ */

async function serverStatus() {
  const pids = await portPids(cfg.webPort);
  const running = pids.length > 0;
  let httpOk = false;
  if (running) httpOk = await probeHttp(cfg.webPort);
  const logFile = path.join(cfg.dshRoot, ".dshctl", "server.console.log");
  return {
    running,
    httpOk,
    port: cfg.webPort,
    profile: cfg.profile ?? "web",
    pid: state.proc ? state.proc.pid : pids[0] ?? null,
    owned: !!state.proc,
    startedAt: state.startedAt,
    logFile: existsSync(logFile) ? logFile : null,
    logSize: existsSync(logFile) ? statSync(logFile).size : 0,
    logSeq: state.seq,
    busy: state.busy
  };
}

async function startServer() {
  if (state.busy) return { ok: false, error: "已有操作在执行，请稍候" };
  if (state.proc) return { ok: true, already: true };

  const binPath = path.join(cfg.dshRoot, "apps", "cli", "src", "bin.ts");
  if (!existsSync(binPath)) {
    return { ok: false, error: `找不到 dsh 入口 ${binPath}（检查 config.json 的 dshRoot）` };
  }
  const busyPids = await portPids(cfg.webPort);
  if (busyPids.length > 0) {
    return { ok: false, error: `端口 ${cfg.webPort} 已被其他进程占用 (PID ${busyPids.join(",")})` };
  }

  state.busy = true;
  const logFile = path.join(cfg.dshRoot, ".dshctl", "server.console.log");
  await mkdir(path.dirname(logFile), { recursive: true }).catch(() => {});
  // 尽力而为写盘：文件可能被正在运行的实例（如 dsh.cmd 的 Tee-Object）锁定 → EBUSY，
  // 此时降级为仅内存环形缓冲，绝不因此让启动器崩溃
  let stream = null;
  try {
    stream = createWriteStream(logFile, { flags: "w" }); // 与 dsh.cmd 一致：每次启动清空重写
    stream.on("error", (err) => {
      pushLog(`[launcher] 日志文件不可写（${err.message}），改用内存缓冲`);
    });
  } catch (err) {
    pushLog(`[launcher] 无法打开日志文件（${err.message}），改用内存缓冲`);
  }

  // 等价于 `node --import tsx/esm apps/cli/src/bin.ts web --port <port>`；
  // 指定 profile 时用 `--profile <name>`（web 即 --profile web 的别名）
  const args = [
    "--import", "tsx/esm",
    binPath,
    ...(cfg.profile ? ["--profile", cfg.profile] : ["web"]),
    "--port", String(cfg.webPort)
  ];
  pushLog(`[launcher] 启动 dsh web 服务器 → 端口 ${cfg.webPort}（profile: ${cfg.profile ?? "web"}，cwd: ${cfg.dshRoot}）`);
  pushLog(`[launcher] ${process.execPath} ${args.join(" ")}`);

  const proc = spawn(process.execPath, args, {
    cwd: cfg.dshRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    // 指定 DSH_HOME：dsh 用户数据（profile/插件/会话等）跟随所选目录，而非 ~/.dsh
    env: cfg.dshHome ? { ...process.env, DSH_HOME: cfg.dshHome } : process.env
  });
  state.proc = proc;
  state.startedAt = new Date().toISOString();

  const tee = (chunk, prefix) => {
    const text = chunk.toString("utf8");
    if (stream) stream.write(text);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) pushLog(prefix ? `${prefix} ${line}` : line);
    }
  };
  proc.stdout.on("data", (d) => tee(d, ""));
  proc.stderr.on("data", (d) => tee(d, "[stderr]"));

  proc.on("error", (err) => {
    pushLog(`[launcher] 子进程启动失败: ${err.message}`, "error", "server");
  });
  proc.on("exit", (code, signal) => {
    // 非正常退出（code≠0 且非人工 stop）→ 致命错误事件 + 弹窗（可尝试恢复）
    const byStop = state.stopping === true;
    const abnormal = !byStop && code !== 0 && code !== null;
    pushLog(`[launcher] dsh 服务器已退出 (code=${code}${signal ? ` signal=${signal}` : ""})`, abnormal ? "error" : "info", "server");
    if (stream) stream.end();
    state.proc = null;
    state.startedAt = null;
    if (abnormal) {
      broadcastFatal("server", `dsh 服务器异常退出 (code=${code}${signal ? ` signal=${signal}` : ""})，请查看日志或尝试恢复`);
    }
    broadcast({ type: "refresh" });
  });

  state.busy = false;
  return { ok: true };
}

async function stopServer() {
  if (state.busy) return { ok: false, error: "已有操作在执行，请稍候" };
  state.busy = true;
  state.stopping = true; // 人工停止：exit handler 不判为致命错误
  try {
    if (state.proc) {
      pushLog(`[launcher] 停止 dsh 服务器 (taskkill PID ${state.proc.pid} /T /F)`);
      await killTree(state.proc.pid);
    }
    // 安全网：端口上残留的监听进程也一并清理
    const pids = await portPids(cfg.webPort);
    for (const pid of pids) await killTree(pid);
    // 等待端口释放
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if ((await portPids(cfg.webPort)).length === 0) break;
      await sleep(300);
    }
    const free = (await portPids(cfg.webPort)).length === 0;
    pushLog(free ? "[launcher] 服务器已停止，端口已释放" : `[launcher] 警告：端口 ${cfg.webPort} 仍在占用`, free ? "info" : "warn");
    return { ok: free, error: free ? undefined : `端口 ${cfg.webPort} 未能释放` };
  } finally {
    state.stopping = false;
    state.busy = false;
  }
}

/* ------------------------------ HTTP ------------------------------ */

function sendJson(res, obj, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function handleLogs(res, url) {
  const tail = Number(url.searchParams.get("tail") ?? 0);
  const since = Number(url.searchParams.get("since") ?? 0);
  let lines;
  if (tail > 0) lines = state.log.slice(-tail);
  else lines = state.log.filter((e) => e.seq > since);
  sendJson(res, { lines, nextSeq: state.seq });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
  sseClients.add(res);
  const hb = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* 忽略 */ }
  }, 15000);
  req.on("close", () => {
    clearInterval(hb);
    sseClients.delete(res);
  });
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, { ok: false, error: "not found" }, 404);
  }
  const indexExists = existsSync(path.join(DIST_DIR, "index.html"));
  if (!indexExists) {
    return sendJson(res, {
      ok: true,
      name: "dsh-launcher",
      hint: "前端尚未构建 — 开发请运行 `pnpm dev`，生产请先 `pnpm build`"
    }, 200);
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel === "") rel = "index.html";
  let file = path.resolve(DIST_DIR, rel);
  if (!file.startsWith(DIST_DIR)) return sendJson(res, { ok: false, error: "forbidden" }, 403);
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) file = path.join(DIST_DIR, "index.html");
  const ext = path.extname(file).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".map": "application/json"
  };
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;
  try {
    if (req.method === "GET" && p === "/api/status") return sendJson(res, await serverStatus());
    if (req.method === "GET" && p === "/api/env") return sendJson(res, await envInfo());
    if (req.method === "GET" && p === "/api/logs") return handleLogs(res, url);
    if (req.method === "GET" && p === "/api/events") return handleEvents(req, res);

    // ── 一键部署 / 更新 / 配置（dsh 本体独立目录）──
    if (req.method === "GET" && p === "/api/deploy/status") {
      const target = url.searchParams.get("dir");
      return sendJson(res, await deployStatus(target ? path.resolve(LAUNCHER_ROOT, target) : cfg.dshRoot));
    }
    if (req.method === "POST" && p === "/api/deploy") {
      const body = await readBody(req);
      // 异步执行：立即返回，进度经日志 SSE 推送，结果以 deploy 事件推送
      deployDsh(body ?? {})
        .then((r) => broadcast({ type: "deploy", ...r }))
        .catch((e) => broadcast({ type: "deploy", ok: false, error: String(e?.message ?? e) }));
      return sendJson(res, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/deploy/update") {
      const body = await readBody(req);
      updateDsh(body ?? {})
        .then((r) => {
          broadcast({ type: "deploy", action: "update", ...r });
          if (!r.ok) broadcastFatal("update", r.error ?? "更新失败");
        })
        .catch((e) => { broadcast({ type: "deploy", action: "update", ok: false, error: String(e?.message ?? e) }); broadcastFatal("update", String(e?.message ?? e)); });
      return sendJson(res, { ok: true, started: true });
    }

    // ── 更新检查 / 版本选择更新 / 修复 ──
    if (req.method === "GET" && p === "/api/update/check") return sendJson(res, await updateCheck());
    if (req.method === "POST" && p === "/api/update/apply") {
      const body = await readBody(req);
      updateDsh(body ?? {})
        .then((r) => {
          broadcast({ type: "deploy", action: "update", ...r });
          if (!r.ok) broadcastFatal("update", r.error ?? "更新失败");
        })
        .catch((e) => { broadcast({ type: "deploy", action: "update", ok: false, error: String(e?.message ?? e) }); broadcastFatal("update", String(e?.message ?? e)); });
      return sendJson(res, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/update/repair") {
      repairDsh()
        .then((r) => {
          broadcast({ type: "deploy", action: "update", ...r });
          if (!r.ok) broadcastFatal("update", r.error ?? "构建修复失败");
        })
        .catch((e) => { broadcast({ type: "deploy", action: "update", ok: false, error: String(e?.message ?? e) }); broadcastFatal("update", String(e?.message ?? e)); });
      return sendJson(res, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/config") {
      const body = await readBody(req);
      if (body.dshRoot) {
        cfg.dshRoot = path.isAbsolute(body.dshRoot)
          ? path.resolve(body.dshRoot)
          : path.resolve(LAUNCHER_ROOT, body.dshRoot);
        state.envCache = null;
      }
      if (body.dshHome !== undefined) {
        // null/"default" 恢复默认 ~/.dsh；相对路径相对 dshRoot 解析；支持 ~ 展开
        if (body.dshHome === null || body.dshHome === "" || body.dshHome === "default") {
          cfg.dshHome = null;
        } else {
          const home = expandTilde(String(body.dshHome));
          cfg.dshHome = path.isAbsolute(home) ? path.resolve(home) : path.resolve(cfg.dshRoot, home);
        }
        state.envCache = null;
      }
      if (body.webPort) cfg.webPort = Number(body.webPort);
      if (body.launcherPort) cfg.launcherPort = Number(body.launcherPort);
      if (body.profile !== undefined) cfg.profile = body.profile || null;
      persistConfig();
      return sendJson(res, { ok: true, dshRoot: cfg.dshRoot, dshHome: cfg.dshHome, webPort: cfg.webPort, launcherPort: cfg.launcherPort, profile: cfg.profile });
    }

    if (req.method === "POST" && p === "/api/server/start") return sendJson(res, await startServer());
    if (req.method === "POST" && p === "/api/server/stop") return sendJson(res, await stopServer());
    if (req.method === "POST" && p === "/api/server/restart") {
      await stopServer();
      return sendJson(res, await startServer());
    }
    if (req.method === "POST" && p === "/api/open") {
      const body = await readBody(req);
      const target = body?.target ?? "web";
      const map = {
        web: () => openUrl(`http://127.0.0.1:${cfg.webPort}`),
        folder: () => execFile("cmd", ["/c", "start", "", cfg.dshRoot], { windowsHide: true, detached: true }, () => {}),
        vscode: () => execFile("cmd", ["/c", "start", "", "code", cfg.dshRoot], { windowsHide: true, detached: true }, () => {}),
        // 打开服务端日志目录（dshRoot/.dshctl，含 server.console.log）
        logs: () => {
          const logsDir = path.join(cfg.dshRoot, ".dshctl");
          execFile("cmd", ["/c", "start", "", logsDir], { windowsHide: true, detached: true }, () => {});
        }
      };
      const fn = map[target];
      if (!fn) return sendJson(res, { ok: false, error: `未知 target: ${target}` }, 400);
      fn();
      return sendJson(res, { ok: true, target });
    }

    // ── 原生文件夹选择（Windows FolderBrowserDialog，-STA 线程）──
    if (req.method === "POST" && p === "/api/pick-dir") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$f.Description = '选择目录'",
        "$f.ShowNewFolderButton = $true",
        "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"
      ].join("; ");
      const r = await new Promise((resolve) => {
        execFile("powershell", ["-NoProfile", "-STA", "-Command", script], { windowsHide: false, timeout: 120000, encoding: "utf8" }, (err, stdout) => {
          resolve({ ok: !err, out: String(stdout || "").trim() });
        });
      });
      // 取消选择（DialogResult.Cancel）不是错误：out 为空 → path null
      return sendJson(res, { ok: r.ok, path: r.out || null, error: r.ok ? undefined : (r.out || "文件夹选择失败") });
    }

    // ── 插件管理 ──
    if (req.method === "GET" && p === "/api/plugins") {
      return sendJson(res, plugins.overview(pluginCtx));
    }
    if (req.method === "GET" && p === "/api/plugins/search") {
      const q = url.searchParams.get("q") ?? "";
      return sendJson(res, await plugins.search(pluginCtx, q));
    }
    const runPluginTask = (task, okExtra = {}, fatalKind = null) => {
      task
        .then((r) => {
          broadcast({ type: "deploy", action: "plugin", ...r, ...okExtra });
          if (fatalKind && !r.ok) broadcastFatal(fatalKind, r.error ?? "操作失败");
        })
        .catch((e) => {
          const msg = String(e?.message ?? e);
          broadcast({ type: "deploy", action: "plugin", ok: false, error: msg });
          if (fatalKind) broadcastFatal(fatalKind, msg);
        });
    };
    if (req.method === "POST" && p === "/api/plugins/install") {
      const body = await readBody(req);
      const source = body?.source ?? "npm";
      if (source === "routing-suite") {
        runPluginTask(plugins.installRoutingSuite(pluginCtx), {}, "plugin");
      } else if (body?.pkg) {
        runPluginTask(plugins.installNpm(pluginCtx, String(body.pkg)), {}, "plugin");
      } else {
        return sendJson(res, { ok: false, error: "缺少 pkg 参数" }, 400);
      }
      return sendJson(res, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/plugins/toggle") {
      const body = await readBody(req);
      if (!body?.bundle) return sendJson(res, { ok: false, error: "缺少 bundle 参数" }, 400);
      runPluginTask(plugins.toggle(pluginCtx, String(body.bundle), !!body.disabled));
      return sendJson(res, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/plugins/remove") {
      const body = await readBody(req);
      if (!body?.pkg) return sendJson(res, { ok: false, error: "缺少 pkg 参数" }, 400);
      runPluginTask(plugins.removeNpm(pluginCtx, String(body.pkg)));
      return sendJson(res, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/plugins/update") {
      const body = await readBody(req);
      if (!body?.pkg) return sendJson(res, { ok: false, error: "缺少 pkg 参数" }, 400);
      runPluginTask(plugins.updatePlugin(pluginCtx, String(body.pkg)), {}, null);
      return sendJson(res, { ok: true, started: true });
    }

    // ── 会话备份 ──
    if (req.method === "GET" && p === "/api/backup/list") {
      return sendJson(res, { backups: readBackups() });
    }
    if (req.method === "POST" && p === "/api/backup") {
      const body = await readBody(req);
      return sendJson(res, backupSessions(body?.reason ? String(body.reason) : "手动备份"));
    }
    if (req.method === "POST" && p === "/api/backup/delete") {
      const body = await readBody(req);
      if (!body?.id) return sendJson(res, { ok: false, error: "缺少 id" }, 400);
      return sendJson(res, deleteBackup(String(body.id)));
    }

    // ── 用量分析（token 消耗 + 计费）──
    if (req.method === "GET" && p === "/api/usage") {
      return sendJson(res, await usage.usageOverview(cfg));
    }
    if (req.method === "POST" && p === "/api/usage/pricing") {
      const body = await readBody(req);
      // mergePricing：与默认深度合并（含多模型单价表），并兼容旧版扁平字段
      cfg.pricing = usage.mergePricing(body ?? {});
      persistConfig();
      return sendJson(res, { ok: true, pricing: cfg.pricing });
    }

    // ── 启动器设置 / 自身更新 ──
    if (req.method === "GET" && p === "/api/launcher/check") {
      return sendJson(res, await launcherCheck());
    }
    if (req.method === "POST" && p === "/api/launcher/update") {
      launcherUpdate()
        .then((r) => broadcast({ type: "deploy", action: "launcher-update", ...r }))
        .catch((e) => broadcast({ type: "deploy", action: "launcher-update", ok: false, error: String(e?.message ?? e) }));
      return sendJson(res, { ok: true, started: true });
    }

    // ── 事件管理器 / 恢复 ──
    if (req.method === "GET" && p === "/api/events/list") {
      const since = Number(url.searchParams.get("since") ?? 0);
      return sendJson(res, {
        events: state.events.filter((e) => e.seq > since),
        nextSeq: state.eventSeq,
        lastOp: state.lastOp
      });
    }
    if (req.method === "POST" && p === "/api/recover") {
      const body = await readBody(req);
      const kind = body?.kind;
      const task = kind === "update" ? recoverUpdate() : kind === "plugin" ? plugins.recoverPlugin(pluginCtx) : Promise.resolve({ ok: false, error: "未知恢复类型" });
      task
        .then((r) => broadcast({ type: "deploy", action: "recover", kind, ...r }))
        .catch((e) => broadcast({ type: "deploy", action: "recover", kind, ok: false, error: String(e?.message ?? e) }));
      return sendJson(res, { ok: true, started: true });
    }

    return serveStatic(req, res, url);
  } catch (err) {
    sendJson(res, { ok: false, error: String(err?.message ?? err) }, 500);
  }
});

server.on("error", (err) => {
  console.error(`[dsh-launcher] 启动失败: ${err.message}`);
  if (err.code === "EADDRINUSE") {
    console.error(`[dsh-launcher] 端口 ${cfg.launcherPort} 已被占用（可能已有启动器实例在运行）`);
    console.error(`[dsh-launcher] 直接打开浏览器访问 http://127.0.0.1:${cfg.launcherPort} 即可`);
  }
  process.exit(1);
});

// 启动时恢复上次可恢复快照（后端重启后仍能「尝试恢复」）
loadLastOp();

server.listen(cfg.launcherPort, "127.0.0.1", () => {
  console.log(`[dsh-launcher] 启动器 UI: http://127.0.0.1:${cfg.launcherPort}`);
  console.log(`[dsh-launcher] dsh 根目录: ${cfg.dshRoot}   web 端口: ${cfg.webPort}   profile: ${cfg.profile ?? "web"}`);
  if (cfg.openBrowser) openUrl(`http://127.0.0.1:${cfg.launcherPort}`);
  // 周期性探活并推送状态（状态变化也即时推送）
  setInterval(async () => {
    try {
      const s = await serverStatus();
      broadcast({ type: "status", status: s });
    } catch { /* 忽略瞬时错误 */ }
  }, 3000);
});

// Ctrl+C 时清理子进程树
process.on("SIGINT", async () => {
  console.log("\n[dsh-launcher] 收到中断，正在清理…");
  await stopServer().catch(() => {});
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await stopServer().catch(() => {});
  process.exit(0);
});

// 兜底：任何未捕获异常/拒绝只记录，不让启动器整体崩溃
process.on("uncaughtException", (err) => {
  console.error("[dsh-launcher] uncaughtException:", err?.message ?? err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[dsh-launcher] unhandledRejection:", reason);
});
