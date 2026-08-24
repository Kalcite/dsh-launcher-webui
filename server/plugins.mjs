/**
 * dsh-launcher 插件管理模块（server/plugins.mjs）
 * - 已安装/本体自带/外部注入式插件总览
 * - npm @deepseek-ai 插件搜索
 * - 安装/禁用/启用/卸载（profile bundle 层 + cordis.patch.yml）
 * - 特殊插件 dsh-routing-suite（注入器 + 路由预设，含二次修复）
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  cpSync,
  statSync,
  copyFileSync,
  mkdirSync
} from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SPECIAL_PLUGINS = [
  {
    key: "routing-suite",
    name: "dsh-routing-suite",
    url: "https://github.com/yjh051108/dsh-routing-suite",
    description: "运行时注入器（dev_* 工具全家桶）+ 思维模式路由预设（Router Standard / Router Spec）",
    needsFix: true,
    install: { source: "routing-suite" },
    fixNote: "由两个子模块组成（dsh-super-injector + dsh-router-standard）。安装后可能需要二次修复：注入器 lib 预构建、preset.yml 描述引号修复；完成后重启 dsh 生效，可发 /dev_plugin_status 验证注入器 active。"
  },
  {
    key: "better-sidebar",
    name: "dsh-better-sidebar",
    url: "https://github.com/omdsh-dev/DSH-better-sidebar",
    description: "VSCode 风格侧边栏工作台（npm 发布，独立脚本安装，无需额外修补）",
    needsFix: false,
    install: { source: "npm", pkg: "dsh-better-sidebar@latest" },
    fixNote: ""
  }
];

const INJECTOR_VER = "0.3.3";
const INJECTOR_TGZ_URL = (ver) =>
  `https://github.com/yjh051108/dsh-super-injector/releases/download/v${ver}/dsh-external-dsh-super-injector-${ver}.tgz`;
const ROUTING_SUITE_URL = "https://github.com/yjh051108/dsh-routing-suite.git";

/* ------------------------------ 工具 ------------------------------ */

function statIsDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** 当前 profile 目录（跟随 cfg.dshHome / 默认 ~/.dsh） */
function profileDir(ctx) {
  const home = ctx.cfg.dshHome ?? path.join(os.homedir(), ".dsh");
  return path.join(home, "profiles", ctx.cfg.profile ?? "web");
}

/** profile 声明的 bundle 列表（dsh.profile.bundles） */
function profileBundles(ctx) {
  try {
    const m = JSON.parse(readFileSync(path.join(profileDir(ctx), "package.json"), "utf8"));
    return [...((m.dsh?.profile)?.bundles ?? [])];
  } catch {
    return [];
  }
}

/** cordis.patch.yml 中 disabled 的 bundle 集合（轻量行解析） */
function disabledBundles(ctx) {
  const set = new Set();
  const patch = path.join(profileDir(ctx), "cordis.patch.yml");
  try {
    const lines = readFileSync(patch, "utf8").split(/\r?\n/);
    let curId = null;
    for (const line of lines) {
      const idm = line.match(/^\s*-\s*id:\s*["']?([^"'\s]+)/);
      if (idm) {
        curId = idm[1];
      } else if (/^\s+disabled:\s*true/i.test(line) && curId) {
        set.add(curId);
      } else if (line.trim() !== "" && !/^\s/.test(line)) {
        curId = null;
      }
    }
  } catch { /* 无补丁文件 */ }
  return set;
}

/** 本体自带判定：包名存在于 dsh 仓库 packages（workspace 提供） */
function isBuiltin(ctx, pkgName) {
  const base = path.join(ctx.cfg.dshRoot, "packages");
  if (!existsSync(base)) return false;
  for (const group of readdirSync(base)) {
    const g = path.join(base, group);
    if (!statIsDir(g)) continue;
    for (const p of readdirSync(g)) {
      const pj = path.join(g, p, "package.json");
      if (!existsSync(pj)) continue;
      try {
        if (JSON.parse(readFileSync(pj, "utf8")).name === pkgName) return true;
      } catch { /* 忽略损坏包 */ }
    }
  }
  return false;
}

/** 运行 dsh CLI 的 plugin 子命令（kit node + 注入 PATH/DSH_HOME），流式日志 */
function runDshPlugin(ctx, args) {
  return new Promise((resolve) => {
    const bin = path.join(ctx.cfg.dshRoot, "apps", "cli", "src", "bin.ts");
    const nodeDir = path.dirname(ctx.kitNodeExe());
    const env = {
      ...process.env,
      PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ""}`,
      ...(ctx.cfg.dshHome ? { DSH_HOME: ctx.cfg.dshHome } : {})
    };
    ctx.pushLog(`[plugin] $ ${ctx.kitNodeExe()} --import tsx/esm ${bin} plugin --profile ${ctx.cfg.profile ?? "web"} ${args.join(" ")}`);
    const proc = spawn(ctx.kitNodeExe(), ["--import", "tsx/esm", bin, "plugin", "--profile", ctx.cfg.profile ?? "web", ...args], {
      cwd: ctx.cfg.dshRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const tee = (chunk, prefix) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) ctx.pushLog(prefix ? `${prefix} ${line}` : line);
      }
    };
    proc.stdout.on("data", (d) => tee(d, ""));
    proc.stderr.on("data", (d) => tee(d, "[stderr]"));
    proc.on("error", (err) => { ctx.pushLog(`[plugin] 启动失败: ${err.message}`); resolve({ code: -1 }); });
    proc.on("exit", (code) => resolve({ code }));
  });
}

/** 修复 preset.yml：description 值无引号时补双引号（YAML 二次修复） */
function fixPresetYaml(file) {
  try {
    const raw = readFileSync(file, "utf8");
    const lines = raw.split(/\r?\n/);
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("description:") && !/^description:\s*["']/.test(line)) {
        const value = line.slice("description:".length).trim();
        lines[i] = `description: "${value}"`;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(file, lines.join("\r\n"), "utf8");
      return true;
    }
  } catch { /* 文件不存在或不可读 */ }
  return false;
}

/** 确保 profile 的 pnpm-workspace.yaml 允许常用构建脚本（node-pty/esbuild），否则 pnpm add 会拦截构建 */
function ensureBuildAllowance(ctx) {
  const ws = path.join(profileDir(ctx), "pnpm-workspace.yaml");
  let content = "";
  try { content = readFileSync(ws, "utf8"); } catch { /* 不存在则新建 */ }
  // pnpm 11 模板会生成 "node-pty: set this to true or false" 占位符 → 强制替换为 true
  content = content.replace(/^(\s*)node-pty\s*:.*$/m, "$1node-pty: true");
  content = content.replace(/^(\s*)esbuild\s*:.*$/m, "$1esbuild: true");
  const additions = [];
  if (!/allowBuilds\s*:/.test(content)) additions.push("allowBuilds:");
  if (!/^\s*node-pty\s*:/m.test(content)) additions.push("  node-pty: true");
  if (!/^\s*esbuild\s*:/m.test(content)) additions.push("  esbuild: true");
  if (additions.length > 0) {
    content = content.replace(/\s*$/, "") + "\n" + additions.join("\n") + "\n";
  }
  writeFileSync(ws, content, "utf8");
  ctx.pushLog(`[plugin] 已写入 pnpm 构建许可（node-pty/esbuild）→ ${ws}`);
  return true;
}

/* ------------------------------ 业务 ------------------------------ */

/** 插件总览：已安装（含本体标记）+ 外部注入式 */
export function overview(ctx) {
  const disabled = disabledBundles(ctx);
  const installed = profileBundles(ctx).map((name) => ({
    name,
    enabled: !disabled.has(name),
    builtin: isBuiltin(ctx, name)
  }));
  const home = ctx.cfg.dshHome ?? path.join(os.homedir(), ".dsh");
  const external = [];
  const pluginRoot = path.join(home, "plugins");
  if (existsSync(pluginRoot)) {
    for (const dir of readdirSync(pluginRoot)) {
      const pj = path.join(pluginRoot, dir, "package.json");
      if (!existsSync(pj)) continue;
      try {
        const m = JSON.parse(readFileSync(pj, "utf8"));
        if (m.name && !installed.some((i) => i.name === m.name)) {
          external.push({ name: m.name, dir, enabled: !disabled.has(m.name) });
        }
      } catch { /* 忽略 */ }
    }
  }
  return {
    profile: ctx.cfg.profile ?? "web",
    profileDir: profileDir(ctx),
    installed,
    external,
    special: SPECIAL_PLUGINS
  };
}

/**
 * 搜索插件：拉取 @deepseek-ai 候选池后本地过滤。
 * - 精确：关键词 === 包名（含/不含 @deepseek-ai/ 前缀均可）→ 排最前
 * - 模糊：名称或描述包含关键词 → 全部返回（名称命中优先于描述命中）
 * - 空关键词：返回全部候选（按 relevance）
 */
export async function search(ctx, q = "") {
  const kw = (q || "").trim();
  let pool = [];
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent("scope:deepseek-ai")}&size=250`;
    const res = await fetch(url, { headers: { "User-Agent": "dsh-launcher" }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json();
      pool = (data.objects ?? [])
        .map((o) => ({
          name: o.package.name,
          version: o.package.version,
          description: (o.package.description ?? "").slice(0, 200)
        }))
        .filter((p) => p.name.startsWith("@deepseek-ai/")); // 候选池仅限 @deepseek-ai scope
    }
  } catch (e) {
    return { npm: [], special: SPECIAL_PLUGINS, error: String(e?.message ?? e) };
  }

  const lower = kw.toLowerCase();
  const fullName = `@deepseek-ai/${lower.replace(/^@deepseek-ai\//, "")}`;
  let results;
  if (!kw) {
    results = pool; // 空关键词：全部候选（registry 相关性排序）
  } else {
    const exact = pool.filter(
      (p) => p.name.toLowerCase() === fullName || p.name.toLowerCase() === lower
    );
    const nameHit = pool.filter(
      (p) => !exact.includes(p) && p.name.toLowerCase().includes(lower)
    );
    const descHit = pool.filter(
      (p) => !exact.includes(p) && !nameHit.includes(p) && (p.description ?? "").toLowerCase().includes(lower)
    );
    // 精确 → 名称包含 → 描述包含
    results = [...exact, ...nameHit, ...descHit];
  }
  return { npm: results, special: SPECIAL_PLUGINS, error: null };
}

/** 安装前备份：cordis.patch.yml 备份 + 当前 bundles，供「尝试恢复」使用 */
function backupProfileConfig(ctx) {
  const backupDir = typeof ctx.dshDataDir === "function" ? ctx.dshDataDir("backups") : path.join(ctx.cfg.dshRoot, ".dshctl", "backups");
  mkdirSync(backupDir, { recursive: true });
  const patch = path.join(profileDir(ctx), "cordis.patch.yml");
  const patchBackup = path.join(backupDir, `patch-${Date.now()}.yml`);
  if (existsSync(patch)) copyFileSync(patch, patchBackup);
  return { patchBackup, bundles: profileBundles(ctx) };
}

/** 安装 npm 插件：dsh plugin add <pkg>（先写构建许可，失败自动重试一次） */
export async function installNpm(ctx, pkg) {
  ctx.pushLog(`[plugin] ══ 安装 npm 插件 ${pkg} ══`);
  ensureBuildAllowance(ctx);
  if (typeof ctx.backupSessions === "function") ctx.backupSessions(`插件安装前备份：${pkg}`);
  ctx.recordLastOp("plugin", { pkg, ...backupProfileConfig(ctx) });
  let r = await runDshPlugin(ctx, ["add", pkg]);
  if (r.code !== 0) {
    ctx.pushLog("[plugin] 安装失败，写入构建许可后重试一次…", "warn", "plugin");
    ensureBuildAllowance(ctx);
    r = await runDshPlugin(ctx, ["add", pkg]);
  }
  if (r.code !== 0) return { ok: false, error: `dsh plugin add ${pkg} 失败 (exit ${r.code})，请查看日志` };
  ctx.pushLog("[plugin] 安装完成（重启 dsh 后生效）");
  return { ok: true };
}

/**
 * 更新插件（分级路径）：
 * - npx 安装 → 无需手动更新（自动跟随）
 * - 源码构建（workspace 包）→ 随 dsh 更新（git pull + install + build）
 * - 用户安装（npm/profile）→ dsh plugin update <pkg>（better-sidebar 按 README 用 add @latest）
 * - routing-suite → 暂不更新
 */
export async function updatePlugin(ctx, pkg) {
  const base = String(pkg).replace(/@[^@]*$/, "");
  if (base.includes("dsh-routing-suite") || base.includes("dsh-super-injector")) {
    return { ok: false, error: "dsh-routing-suite 暂不支持自动更新（按仓库发布流程手动处理）" };
  }
  if (isBuiltin(ctx, base)) {
    return { ok: false, error: `${base} 是本体自带插件，更新随 dsh 本体进行（管理 dsh → 更新 dsh）` };
  }
  if (typeof ctx.backupSessions === "function") ctx.backupSessions(`插件更新前备份：${base}`);
  ctx.pushLog(`[plugin] ══ 更新插件 ${base} ══`);
  let r;
  if (base === "dsh-better-sidebar") {
    // 按仓库 README 方法：npm 发布，add @latest 覆盖更新
    ctx.pushLog("[plugin] better-sidebar 按仓库 README 方法更新（add @latest）…");
    ensureBuildAllowance(ctx);
    r = await runDshPlugin(ctx, ["add", `${base}@latest`]);
    if (r.code !== 0) {
      ensureBuildAllowance(ctx);
      r = await runDshPlugin(ctx, ["add", `${base}@latest`]);
    }
  } else {
    r = await runDshPlugin(ctx, ["update", base]);
  }
  if (r.code !== 0) return { ok: false, error: `插件更新失败 (exit ${r.code})，请查看日志` };
  ctx.pushLog(`[plugin] 更新完成（重启 dsh 后生效）`);
  return { ok: true };
}

/** 恢复插件安装造成的错误：清除安装内容 + 还原 cordis.patch.yml */
export async function recoverPlugin(ctx) {
  const op = typeof ctx.lastOp === "function" ? ctx.lastOp() : ctx.lastOp;
  if (!op || op.kind !== "plugin") return { ok: false, error: "没有可恢复的插件操作快照" };
  const { pkg, patchBackup, bundles } = op.data;
  ctx.pushLog("[plugin] ══ 恢复插件安装 ══");
  // 1) 若该插件仍在 bundles 中 → 卸载（pkg 可能带 @latest 等版本后缀，需归一化）
  const basePkg = pkg ? String(pkg).replace(/@[^@]*$/, "") : null;
  const installed = (bundles ?? []).some((b) => basePkg && (b === basePkg || b.includes(basePkg)));
  if (basePkg && installed) {
    ctx.pushLog(`[plugin] 卸载 ${basePkg}（清除安装内容）…`);
    const r = await runDshPlugin(ctx, ["remove", basePkg]);
    if (r.code !== 0) ctx.pushLog(`[plugin] ⚠ 卸载失败 (exit ${r.code})，继续还原配置`, "warn", "plugin");
  } else {
    ctx.pushLog("[plugin] 插件不在 bundles 中，跳过卸载");
  }
  // 2) 还原 cordis.patch.yml
  const patch = path.join(profileDir(ctx), "cordis.patch.yml");
  if (patchBackup && existsSync(patchBackup)) {
    copyFileSync(patchBackup, patch);
    ctx.pushLog(`[plugin] 已还原 cordis.patch.yml → ${patch}`);
  } else {
    // 无备份 → 清空 disabled 标记（写空列表占位）
    try {
      const raw = readFileSync(patch, "utf8");
      const cleaned = raw.replace(/^\s*-\s*id:.*(?:\r?\n\s+disabled:\s*true.*)?$/gm, "").replace(/\n{3,}/g, "\n\n").trim() || "[]";
      writeFileSync(patch, cleaned, "utf8");
      ctx.pushLog("[plugin] 已清理 cordis.patch.yml 的禁用标记", "warn", "plugin");
    } catch { /* 无补丁文件 */ }
  }
  ctx.pushLog("[plugin] ══ 插件恢复完成（重启 dsh 后生效） ══");
  return { ok: true };
}

/** 卸载 npm 插件：dsh plugin remove <pkg>（本体自带拒绝） */
export async function removeNpm(ctx, pkg) {
  if (isBuiltin(ctx, pkg)) return { ok: false, error: `${pkg} 是本体自带插件，不可卸载` };
  ctx.pushLog(`[plugin] ══ 卸载插件 ${pkg} ══`);
  const r = await runDshPlugin(ctx, ["remove", pkg]);
  if (r.code !== 0) return { ok: false, error: `dsh plugin remove ${pkg} 失败 (exit ${r.code})` };
  ctx.pushLog("[plugin] 卸载完成（重启 dsh 后生效）");
  return { ok: true };
}

/** 禁用/启用：通过 kit venv 的 plugin.py（pyyaml 编辑 cordis.patch.yml；本体自带拒绝） */
export async function toggle(ctx, bundle, disable) {
  if (isBuiltin(ctx, bundle)) return { ok: false, error: `${bundle} 是本体自带插件，不可修改` };
  const venvPy = path.join(ctx.LAUNCHER_ROOT, ".runtime", "venv", "Scripts", "python.exe");
  const pyScript = path.join(ctx.LAUNCHER_ROOT, "tools", "plugin.py");
  const cmd = disable ? "disable" : "enable";
  ctx.pushLog(`[plugin] ${disable ? "禁用" : "启用"} ${bundle}（编辑 cordis.patch.yml）…`);
  const env = { ...process.env, ...(ctx.cfg.dshHome ? { DSH_HOME: ctx.cfg.dshHome } : {}) };
  const code = await new Promise((resolve) => {
    const proc = spawn(venvPy, [pyScript, cmd, bundle, "--profile", ctx.cfg.profile ?? "web"], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const tee = (chunk, prefix) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) ctx.pushLog(prefix ? `${prefix} ${line}` : line);
      }
    };
    proc.stdout.on("data", (d) => tee(d, ""));
    proc.stderr.on("data", (d) => tee(d, "[stderr]"));
    proc.on("error", (err) => { ctx.pushLog(`[plugin] 启动失败: ${err.message}`); resolve(-1); });
    proc.on("exit", (c) => resolve(c));
  });
  if (code !== 0) return { ok: false, error: `plugin.py ${cmd} ${bundle} 失败 (exit ${code})` };
  ctx.pushLog(`[plugin] ${disable ? "已禁用" : "已启用"} ${bundle}（重启 dsh 后生效）`);
  return { ok: true };
}

/** 特殊插件：dsh-routing-suite（注入器 + 路由预设 + 二次修复） */
export async function installRoutingSuite(ctx) {
  const home = ctx.cfg.dshHome ?? path.join(os.homedir(), ".dsh");
  const pluginDir = path.join(home, "plugins");
  const presetRoot = path.join(home, ".agent-presets");
  const injectorDir = path.join(pluginDir, "dsh-super-injector");
  const injectorExe = path.join(injectorDir, "lib", "index.js");

  ctx.pushLog("[plugin] ══ 安装 dsh-routing-suite ══");

  // 1) 注入器（Release 预构建 tgz，免构建）
  if (existsSync(injectorExe)) {
    ctx.pushLog(`[plugin] 注入器已存在：${injectorDir}`);
  } else {
    await mkdir(pluginDir, { recursive: true });
    const tgz = path.join(os.tmpdir(), `dsh-super-injector-${INJECTOR_VER}.tgz`);
    ctx.pushLog(`[plugin] 下载注入器 Release v${INJECTOR_VER} …`);
    try {
      const res = await fetch(INJECTOR_TGZ_URL(INJECTOR_VER), { signal: AbortSignal.timeout(180000) });
      if (!res.ok) return { ok: false, error: `下载注入器失败 (HTTP ${res.status})` };
      writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      return { ok: false, error: `下载注入器失败: ${e?.message ?? e}` };
    }
    await mkdir(injectorDir, { recursive: true });
    const r = await ctx.runStream("cmd", ["/c", "tar", "-xzf", tgz, "-C", injectorDir, "--strip-components=1"]);
    rmSync(tgz, { force: true });
    if (r.code !== 0 || !existsSync(injectorExe)) {
      return { ok: false, error: "注入器解压失败或缺少 lib/index.js" };
    }
    ctx.pushLog(`[plugin] 注入器就绪：${injectorDir}`);
  }

  // 2) 装配注入器到 profile
  let r = await runDshPlugin(ctx, ["add", injectorDir]);
  if (r.code !== 0) return { ok: false, error: "注入器装配失败" };
  ctx.pushLog("[plugin] 注入器已装配（重启后由 bundles 接管）");

  // 3) 克隆套件（含子模块）+ 平铺安装预设
  const suite = path.join(os.tmpdir(), `dsh-routing-suite-${Date.now()}`);
  ctx.pushLog("[plugin] 克隆 routing-suite（含 submodule）…");
  r = await ctx.runStream("git", ["clone", "--depth", "1", "--recurse-submodules", ROUTING_SUITE_URL, suite]);
  if (r.code !== 0) return { ok: false, error: "套件克隆失败（可能网络或子模块问题）" };
  await mkdir(presetRoot, { recursive: true });
  let installedPresets = 0;
  for (const p of ["router-standard", "router-spec"]) {
    const src = path.join(suite, "preset", "preset", p);
    const dst = path.join(presetRoot, p);
    if (!existsSync(path.join(src, "agent.cordis.yml"))) {
      ctx.pushLog(`[plugin] ⚠ 预设 ${p} 结构异常（缺少 agent.cordis.yml），已跳过`);
      continue;
    }
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    const fixed = fixPresetYaml(path.join(dst, "preset.yml"));
    ctx.pushLog(`[plugin] 已安装预设 ${p} → ${dst}${fixed ? "（已修复 preset.yml 描述引号）" : ""}`);
    installedPresets++;
  }
  rmSync(suite, { recursive: true, force: true });

  ctx.pushLog(`[plugin] ══ routing-suite 安装完成（注入器 + ${installedPresets}/2 预设）══`);
  ctx.pushLog("[plugin] 重启 dsh 后生效：新会话可选 Router Standard / Router Spec；可发 /dev_plugin_status 验证注入器 active");
  return { ok: true, installedPresets };
}
