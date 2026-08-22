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
  writeFileSync
} from "node:fs";
import { mkdir, readdir, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

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

/* ------------------------------ 状态 ------------------------------ */

const state = {
  proc: null,       // 由本启动器拉起的 dsh 子进程
  startedAt: null,
  busy: false,      // 有启停操作在执行
  log: [],          // 环形日志 [{ seq, line }]
  seq: 0,
  envCache: null,
  envCacheAt: 0
};
const sseClients = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pushLog(line) {
  const entry = { seq: state.seq++, line };
  state.log.push(entry);
  if (state.log.length > cfg.logLines) state.log.splice(0, state.log.length - cfg.logLines);
  broadcast({ type: "log", entry });
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
      stdio: ["ignore", "pipe", "pipe"]
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
 * 客户端 bundle 健康检查：扫描声明了 dsh.client 的包，核对 lib/client.js 是否存在。
 * 缺失的 bundle 会导致浏览器端 "bundle script ... failed to load"。
 */
function checkClientBundles(root) {
  const missing = [];
  let total = 0;
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
    return { ok: true, version: version ?? "latest", health: health ?? { total: 0, missing: [] }, status: await deployStatus(root) };
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
      openBrowser: cfg.openBrowser
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
  const [node, pnpm, git] = await Promise.all([
    run(process.execPath, ["--version"]),
    // Windows 上 pnpm 是 .ps1/.cmd shim，execFile 无法直接执行 → 用 cmd /c 包装
    run("cmd", ["/c", "pnpm --version"]),
    run("git", ["--version"])
  ]);
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
    dshRoot: cfg.dshRoot,
    dshHome: cfg.dshHome, // null = 默认 ~/.dsh
    webPort: cfg.webPort,
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
    pushLog(`[launcher] 子进程启动失败: ${err.message}`);
  });
  proc.on("exit", (code, signal) => {
    pushLog(`[launcher] dsh 服务器已退出 (code=${code}${signal ? ` signal=${signal}` : ""})`);
    if (stream) stream.end();
    state.proc = null;
    state.startedAt = null;
    broadcast({ type: "refresh" });
  });

  state.busy = false;
  return { ok: true };
}

async function stopServer() {
  if (state.busy) return { ok: false, error: "已有操作在执行，请稍候" };
  state.busy = true;
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
    pushLog(free ? "[launcher] 服务器已停止，端口已释放" : `[launcher] 警告：端口 ${cfg.webPort} 仍在占用`);
    return { ok: free, error: free ? undefined : `端口 ${cfg.webPort} 未能释放` };
  } finally {
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
        .then((r) => broadcast({ type: "deploy", action: "update", ...r }))
        .catch((e) => broadcast({ type: "deploy", action: "update", ok: false, error: String(e?.message ?? e) }));
      return sendJson(res, { ok: true, started: true });
    }

    // ── 更新检查 / 版本选择更新 / 修复 ──
    if (req.method === "GET" && p === "/api/update/check") return sendJson(res, await updateCheck());
    if (req.method === "POST" && p === "/api/update/apply") {
      const body = await readBody(req);
      updateDsh(body ?? {})
        .then((r) => broadcast({ type: "deploy", action: "update", ...r }))
        .catch((e) => broadcast({ type: "deploy", action: "update", ok: false, error: String(e?.message ?? e) }));
      return sendJson(res, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/update/repair") {
      repairDsh()
        .then((r) => broadcast({ type: "deploy", action: "update", ...r }))
        .catch((e) => broadcast({ type: "deploy", action: "update", ok: false, error: String(e?.message ?? e) }));
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
        vscode: () => execFile("cmd", ["/c", "start", "", "code", cfg.dshRoot], { windowsHide: true, detached: true }, () => {})
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
