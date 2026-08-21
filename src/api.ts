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
  dshRoot: string;
  dshHome: string | null;
  webPort: number;
  profile: string | null;
};

export type LogEntry = { seq: number; line: string };

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

export type SseMsg =
  | { type: "hello" }
  | { type: "log"; entry: LogEntry }
  | { type: "status"; status: ServerStatus }
  | { type: "refresh" }
  | { type: "deploy"; ok: boolean; target?: string; error?: string };

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
  open: (target: "web" | "folder" | "vscode") =>
    fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target })
    }).then((r) => j<{ ok: boolean }>(r)),
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
  saveConfig: (body: { dshRoot?: string; dshHome?: string | null; webPort?: number }) =>
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then((r) => j<{ ok: boolean; dshRoot?: string; dshHome?: string | null }>(r))
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
