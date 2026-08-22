export type ServerStatus = {
  running: boolean;
  httpOk: boolean;
  port: number;
  profile: string | null;
  pid: number | null;
  owned: boolean;
  startedAt: string | null;
  logFile: string | null;
  logSize: number;
  logSeq: number;
  busy: boolean;
};

export type EnvInfo = {
  node: string;
  pnpm: string;
  git: string;
  portableNode: string | null;
  launcherVersion: string | null;
  launcherCommit: string | null;
  dshRoot: string;
  dshHome: string | null;
  webPort: number;
  launcherPort: number;
  profile: string | null;
};

export type LogEntry = { seq: number; line: string; level?: "info" | "warn" | "error"; source?: string };

export type EventRecord = {
  seq: number;
  ts: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
};

export type FatalInfo = {
  kind: "update" | "plugin" | "server";
  message: string;
  recoverable: boolean;
};

export type DeployStatus = {
  dshRoot: string;
  exists: boolean;
  isGitRepo: boolean;
  gitBranch: string | null;
  gitCommit: string | null;
  pkgVersion: string | null;
  hasNodeModules: boolean;
  hasWebDist: boolean;
  hasBuildMarkers: boolean;
  entryOk: boolean;
  deployed: boolean;
};

export type ReleaseInfo = {
  tag: string;
  name: string;
  publishedAt: string | null;
  prerelease: boolean;
  body: string;
};

export type UpdateCheck = {
  dshRoot: string;
  current: { pkgVersion: string | null; branch: string | null; commit: string | null; tag: string | null };
  clientBundles: { total: number; missing: { name: string; path: string }[] };
  releases: ReleaseInfo[];
  error: string | null;
};

export type PluginItem = {
  name: string;
  enabled: boolean;
  builtin?: boolean;
  dir?: string;
};

export type SpecialPlugin = {
  key: string;
  name: string;
  url: string;
  description: string;
  needsFix: boolean;
  install: { source: "npm" | "routing-suite"; pkg?: string };
  fixNote: string;
};

export type PluginOverview = {
  profile: string;
  profileDir: string;
  installed: PluginItem[];
  external: PluginItem[];
  special: SpecialPlugin[];
};

export type PluginSearchResult = {
  npm: { name: string; version: string; description: string }[];
  special: SpecialPlugin[];
  error: string | null;
};

export type SseMsg =
  | { type: "hello" }
  | { type: "log"; entry: LogEntry }
  | { type: "event"; event: EventRecord }
  | { type: "status"; status: ServerStatus }
  | { type: "refresh" }
  | { type: "deploy"; ok: boolean; target?: string; error?: string }
  | { type: "fatal"; kind: "update" | "plugin" | "server"; message: string; recoverable: boolean };

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => fetch("/api/status").then((r) => j<ServerStatus>(r)),
  env: () => fetch("/api/env").then((r) => j<EnvInfo>(r)),
  logs: (tail: number) =>
    fetch(`/api/logs?tail=${tail}`).then((r) => j<{ lines: LogEntry[]; nextSeq: number }>(r)),
  action: (a: "start" | "stop" | "restart") =>
    fetch(`/api/server/${a}`, { method: "POST" }).then((r) => j<{ ok: boolean; error?: string }>(r)),
  open: (target: "web" | "folder" | "vscode" | "logs") =>
    fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target })
    }).then((r) => j<{ ok: boolean }>(r)),
  /** 打开 Windows 原生文件夹选择对话框，返回所选路径（取消时 path 为 null） */
  pickDir: () =>
    fetch("/api/pick-dir", { method: "POST" }).then((r) => j<{ ok: boolean; path?: string | null }>(r)),
  deployStatus: (dir?: string) =>
    fetch(`/api/deploy/status${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`).then((r) => j<DeployStatus>(r)),
  deploy: (body: { targetDir?: string; skipBuild?: boolean }) =>
    fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => j<{ ok: boolean; error?: string }>(r)),
  deployUpdate: (body: { skipBuild?: boolean }) =>
    fetch("/api/deploy/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => j<{ ok: boolean; error?: string }>(r)),
  updateCheck: () => fetch("/api/update/check").then((r) => j<UpdateCheck>(r)),
  updateApply: (body: { version?: string; skipBuild?: boolean }) =>
    fetch("/api/update/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r)),
  updateRepair: () =>
    fetch("/api/update/repair", { method: "POST" }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r)),
  saveConfig: (body: { dshRoot?: string; dshHome?: string | null; webPort?: number; launcherPort?: number; profile?: string | null }) =>
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => j<{ ok: boolean; dshRoot?: string; dshHome?: string | null }>(r)),
  plugins: () => fetch("/api/plugins").then((r) => j<PluginOverview>(r)),
  pluginSearch: (q: string) =>
    fetch(`/api/plugins/search?q=${encodeURIComponent(q)}`).then((r) => j<PluginSearchResult>(r)),
  pluginInstall: (body: { source?: "npm" | "routing-suite"; pkg?: string }) =>
    fetch("/api/plugins/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r)),
  pluginToggle: (bundle: string, disabled: boolean) =>
    fetch("/api/plugins/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, disabled })
    }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r)),
  pluginRemove: (pkg: string) =>
    fetch("/api/plugins/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pkg })
    }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r)),
  eventsList: (since = 0) =>
    fetch(`/api/events/list?since=${since}`).then((r) =>
      j<{ events: EventRecord[]; nextSeq: number; lastOp: { kind: string; ts: number; data: unknown } | null }>(r)
    ),
  recover: (kind: "update" | "plugin") =>
    fetch("/api/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind })
    }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r)),
  launcherCheck: () => fetch("/api/launcher/check").then((r) =>
    j<{ current: string; latest: { tag: string; name: string; publishedAt: string; body: string } | null; hasUpdate: boolean; error: string | null; repo: string }>(r)
  ),
  launcherUpdate: () =>
    fetch("/api/launcher/update", { method: "POST" }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r)),
  backupList: () => fetch("/api/backup/list").then((r) =>
    j<{ backups: { id: string; ts: number; reason: string; files: number; size: number; skipped?: boolean }[] }>(r)
  ),
  backup: (reason?: string) =>
    fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    }).then((r) => j<{ ok: boolean; id?: string; error?: string }>(r)),
  backupDelete: (id: string) =>
    fetch("/api/backup/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    }).then((r) => j<{ ok: boolean; error?: string }>(r)),
  pluginUpdate: (pkg: string) =>
    fetch("/api/plugins/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pkg })
    }).then((r) => j<{ ok: boolean; started?: boolean; error?: string }>(r))
};

/** SSE 连接（自动重连由 EventSource 内置处理），返回关闭函数 */
export function connectSse(onMsg: (m: SseMsg) => void): () => void {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    try {
      onMsg(JSON.parse(e.data) as SseMsg);
    } catch {
      /* 忽略非 JSON 心跳 */
    }
  };
  return () => es.close();
}
