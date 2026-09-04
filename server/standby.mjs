/**
 * dsh-launcher 备用服务器模块（server/standby.mjs）
 *
 * .dsh_temp/dsh  —— 固定版本 dsh 本体（clone + 构建产物，不入库、不随启动器更新）
 * .dsh_temp/.dsh —— 备用端独立 DSH_HOME（与主端 ~/.dsh 完全隔离：仅 router + sidebar + 运维 skill）
 *
 * 全部网络/进程/文件操作经 ctx 注入，本模块只含纯逻辑，可离线单测：
 *   ctx.LAUNCHER_ROOT / ctx.cfg
 *   ctx.log(line[, level[, source]])          ctx.runStream(cmd, args, opts) → {code}
 *   ctx.kitNodeExe() / ctx.kitPnpm() / ctx.kitEnv()
 *   ctx.ensureWebDist(root, pnpm) → code       ctx.portPids(port) → number[]
 *   ctx.probeHttp(port) → {ok, code}           ctx.readdirSafe(p) → string[]
 *   ctx.gitHead(root) → {commit, subject, tag}|null
 *   ctx.state —— { proc, startedAt, busy, stopping }
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as plugins from "./plugins.mjs";

/** 固定版本信息（最稳定组合登记值；跨设备部署同版本） */
export const STANDBY = {
  tag: "dsh-v0.1.3-alpha.1",
  commit: "d347e70",
  url: "https://github.com/deepseek-ai/deepseek-harness.git",
  relRoot: path.join(".dsh_temp", "dsh"),
  relHome: path.join(".dsh_temp", ".dsh"),
  defaultPort: 3090, // 备用端 Web UI 端口（固定默认，与主端 webPort 解耦）
  profile: "web",
  // better-sidebar ≥0.18：不再 import 已被 dsh 0.1.3-alpha.1 移除的 settingsNamespace（2026-09-04 启动即退 code=1 的根因）
  sidebarPkg: "dsh-better-sidebar@0.18.0",
  skillRel: path.join(".agents", "skills", "dsh-operations")
};

/** 解析备用端路径/端口（config 键：standbyRoot/standbyHome/standbyWebPort/standbyTag/standbyProfile） */
export function standbyPaths(launcherRoot, cfg = {}) {
  const root = path.resolve(launcherRoot, cfg.standbyRoot ?? STANDBY.relRoot);
  const homeRaw = cfg.standbyHome ?? STANDBY.relHome;
  const home = path.isAbsolute(homeRaw) ? path.resolve(homeRaw) : path.resolve(launcherRoot, homeRaw);
  const port = Number(cfg.standbyWebPort ?? STANDBY.defaultPort);
  const tag = cfg.standbyTag ?? STANDBY.tag;
  const profile = cfg.standbyProfile ?? STANDBY.profile;
  return {
    root,
    home,
    port,
    tag,
    profile,
    binPath: path.join(root, "apps", "cli", "src", "bin.ts"),
    webDist: path.join(root, "apps", "web", "dist", "index.html"),
    consoleLog: path.join(launcherRoot, ".dshctl", String(root).replace(/[^a-zA-Z0-9._-]/g, "_"), "server.console.log"),
    webUrl: `http://127.0.0.1:${port}`
  };
}

/**
 * 检测备用本体目录（.dsh_temp/dsh）的当前状态（供部署自动决策与 UI 展示）：
 *   dirExists / gitRepo / hasPkg(root/package.json) / hasEntry(bin.ts) / hasDeps(node_modules)
 *   state: "absent" | "empty" | "git-repo" | "dsh-source" | "foreign-files"
 *     - absent     目录不存在或为空
 *     - git-repo   已是 git 仓库（clone/中断恢复/已部署过）→ 同步固定 tag 即可
 *     - dsh-source 非 git 但已有 dsh 相关文件（package.json + apps/cli/src/bin.ts）→ 无法安全接管，需清理或换目录
 *     - foreign-files 非空且非 git、非 dsh 源码（克隆中断等）→ 需清理
 */
export function sbDirState(root) {
  const dirExists = existsSync(root);
  const gitRepo = existsSync(path.join(root, ".git"));
  const hasPkg = existsSync(path.join(root, "package.json"));
  const hasEntry = existsSync(path.join(root, "apps", "cli", "src", "bin.ts"));
  const hasDeps = existsSync(path.join(root, "node_modules"));
  let state = "absent";
  if (dirExists) {
    if (gitRepo) state = "git-repo";
    else if (hasPkg && hasEntry) state = "dsh-source";
    else if (hasPkg || hasEntry || hasDeps) state = "foreign-files"; // 部分残留
    else {
      let n = -1;
      try { n = readdirSync(root).length; } catch { /* 不可读 */ }
      state = n > 0 ? "foreign-files" : "empty";
    }
  }
  return { dirExists, gitRepo, hasPkg, hasEntry, hasDeps, state };
}

/** 备用端状态汇总（不做 git 等重操作，供 UI 轮询/动作后刷新） */
export async function sbStatus(ctx) {
  const p = ctx.paths();
  const st = {
    ...p,
    dir: sbDirState(p.root),
    deployed: false,
    distOk: false,
    provisioned: false,
    running: false,
    httpOk: false,
    httpCode: null,
    pid: null,
    owned: false,
    busy: !!ctx.state?.busy
  };
  st.deployed = existsSync(p.binPath);
  if (st.deployed) st.distOk = existsSync(p.webDist);
  st.provisioned = existsSync(path.join(p.home, "profiles", p.profile, "package.json"));
  const pids = await ctx.portPids(p.port);
  st.running = pids.length > 0;
  if (st.running) {
    const h = await ctx.probeHttp(p.port);
    st.httpOk = !!h?.ok;
    st.httpCode = h?.code ?? null;
    st.pid = pids[0] ?? null;
    st.owned = !!ctx.state?.proc && ctx.state.proc.pid === pids[0];
  }
  return st;
}

/**
 * 一键部署备用端：git clone/同步固定 tag → pnpm install → pnpm run build → 补 build:web。
 * 全程不碰主 dsh、不切换 config.dshRoot。busy 由调用方（端点层）保证。
 */
export async function sbBootstrap(ctx, opts = {}) {
  const p = ctx.paths();
  const tag = opts.tag ?? p.tag;
  ctx.log(`[standby] ══ 部署备用端 dsh（固定 ${tag}）→ ${p.root} ══`);
  try { mkdirSync(path.dirname(p.root), { recursive: true }); } catch { /* 忽略 */ }
  // 1) git：自动检测目录与相关文件 → 决定「全新克隆 / 同步固定版本 / 拒绝接管」
  const det = sbDirState(p.root);
  ctx.log(`[standby] 目录检测：${det.state}（.git=${det.gitRepo}，package.json=${det.hasPkg}，bin.ts=${det.hasEntry}，node_modules=${det.hasDeps}）`);
  if (det.state === "git-repo") {
    ctx.log("[standby] 检测到 git 仓库：fetch 固定 tag 并检出（保持固定，不随主端更新）…");
    let r = await ctx.runStream("git", ["-C", p.root, "fetch", "--depth", "1", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
    if (r.code === 0) r = await ctx.runStream("git", ["-C", p.root, "checkout", "-q", `refs/tags/${tag}`, "-f"]);
    if (r.code !== 0) return { ok: false, error: `同步固定 tag ${tag} 失败` };
  } else if (det.state === "absent" || det.state === "empty") {
    ctx.log(`[standby] git clone --depth 1 --branch ${tag} ${STANDBY.url}`);
    const r = await ctx.runStream("git", ["clone", "--depth", "1", "--branch", tag, "--single-branch", STANDBY.url, p.root], { cwd: path.dirname(p.root) });
    if (r.code !== 0) return { ok: false, error: `git clone ${tag} 失败（网络或 tag 不存在）` };
  } else if (det.state === "dsh-source") {
    return { ok: false, error: `目录 ${p.root} 非 git 仓库但含 dsh 源码（package.json + bin.ts）——为保护现场不覆盖，请清空该目录后重试，或改 config standbyRoot` };
  } else {
    return { ok: false, error: `目录 ${p.root} 非空且非 git 仓库（可能有上次克隆/构建的残留文件），请清空该目录后重试，或改 config standbyRoot` };
  }
  // 2) install + build
  const pnpm = ctx.kitPnpm();
  const env = ctx.kitEnv();
  ctx.log("[standby] 安装依赖 (pnpm install)…");
  let code = pnpm
    ? (await ctx.runStream("cmd", ["/c", pnpm, "install"], { cwd: p.root, env })).code
    : (await ctx.runStream("cmd", ["/c", "pnpm install"], { cwd: p.root, env })).code;
  if (code !== 0) return { ok: false, error: `pnpm install 失败 (exit ${code})` };
  ctx.log("[standby] 构建 (pnpm run build)…");
  code = pnpm
    ? (await ctx.runStream("cmd", ["/c", pnpm, "run", "build"], { cwd: p.root, env })).code
    : (await ctx.runStream("cmd", ["/c", "pnpm run build"], { cwd: p.root, env })).code;
  if (code !== 0) return { ok: false, error: `pnpm run build 失败 (exit ${code})` };
  const webCode = await ctx.ensureWebDist(p.root, pnpm);
  if (webCode !== 0) return { ok: false, error: `pnpm run build:web 失败 (exit ${webCode})` };
  const git = await ctx.gitHead(p.root).catch(() => null);
  ctx.log(`[standby] ══ 备用端部署完成 → ${p.root}（${git?.describe ?? git?.commit ?? tag}）══`);
  return { ok: true, target: p.root, tag, git };
}

/** 备用端插件 ctx：把 routing-suite / sidebar 安装导向备用 dshRoot + 独立 DSH_HOME */
function mkPluginCtx(ctx, p) {
  const log = (line, level = "info", source = "standby") => ctx.log(`[standby] ${line}`, level, source);
  return {
    cfg: { dshRoot: p.root, dshHome: p.home, profile: p.profile, webPort: p.port },
    LAUNCHER_ROOT: ctx.LAUNCHER_ROOT,
    pushLog: log,
    runStream: (cmd, args, opts) => ctx.runStream(cmd, args, opts),
    kitNodeExe: () => ctx.kitNodeExe(),
    recordLastOp: () => {},
    lastOp: () => ({}),
    backupSessions: () => ({ ok: true })
  };
}

/**
 * 初始化备用端独立用户目录：router（注入器+预设，走 v0.7.7 双布局+0.1.3 兼容层）
 * + better-sidebar（固定 ≥0.18）+ 复制运维 skill 到 <home>/skills（user-dsh 根）。
 * 不创建会话数据；首次启动备用 dsh 时自动补 profiles/storages 骨架。
 */
export async function sbProvision(ctx) {
  const p = ctx.paths();
  ctx.log(`[standby] ══ 初始化备用端用户目录（独立 DSH_HOME）→ ${p.home} ══`);
  if (!existsSync(p.binPath)) {
    return { ok: false, error: `备用 dsh 未部署（${p.root}），请先「一键部署备用端」` };
  }
  const pl = mkPluginCtx(ctx, p);
  const r1 = await plugins.installRoutingSuite(pl);
  if (!r1?.ok) {
    ctx.log(`[standby] ⚠ routing-suite 安装未完成：${r1?.error ?? "unknown"}`, "warn", "standby");
    return { ok: false, error: r1?.error ?? "routing-suite 安装失败" };
  }
  const r2 = await plugins.installNpm(pl, STANDBY.sidebarPkg);
  if (!r2?.ok) {
    ctx.log(`[standby] ⚠ better-sidebar 安装失败：${r2?.error ?? "unknown"}`, "warn", "standby");
    return { ok: false, error: r2?.error ?? "better-sidebar 安装失败" };
  }
  // 运维 skill → 备用用户目录 user-dsh 根（<home>/skills/<name>/SKILL.md）
  const src = path.join(ctx.LAUNCHER_ROOT, STANDBY.skillRel, "SKILL.md");
  const dstDir = path.join(p.home, "skills", "dsh-operations");
  if (existsSync(src)) {
    try {
      mkdirSync(dstDir, { recursive: true });
      writeFileSync(path.join(dstDir, "SKILL.md"), readFileSync(src, "utf8"), "utf8");
      ctx.log(`[standby] 已复制运维 skill → ${dstDir}`);
    } catch (e) {
      ctx.log(`[standby] ⚠ skill 复制失败：${e?.message ?? e}`, "warn", "standby");
    }
  } else {
    ctx.log(`[standby] ⚠ 仓库未找到运维 skill（${src}），跳过复制`, "warn", "standby");
  }
  ctx.log("[standby] ══ 备用端用户目录就绪：router（注入器+预设）+ better-sidebar + 运维 skill ══");
  return { ok: true, home: p.home };
}
