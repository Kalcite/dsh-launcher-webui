import { useEffect, useRef, useState, useCallback } from "react";
import { api, connectSse, type ServerStatus, type EnvInfo, type LogEntry } from "./api";
import { Sidebar, type Page } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import { ServerCard } from "./components/ServerCard";
import { EnvCard } from "./components/EnvCard";
import { DeployCard } from "./components/DeployCard";
import { UpdateCard } from "./components/UpdateCard";
import { LogsPanel } from "./components/LogsPanel";

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{ ok: boolean; error?: string; target?: string } | null>(null);
  const lastSeq = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      /* 后端短暂不可用 */
    }
    try {
      setEnv(await api.env());
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    refresh();
    api
      .logs(600)
      .then((r) => {
        lastSeq.current = r.nextSeq;
        setLogs(r.lines);
      })
      .catch(() => {});
    const off = connectSse((m) => {
      if (m.type === "log") {
        lastSeq.current = m.entry.seq;
        setLogs((prev) => [...prev.slice(-1500), m.entry]);
      } else if (m.type === "status") {
        setStatus(m.status);
      } else if (m.type === "refresh") {
        refresh();
      } else if (m.type === "deploy") {
        setDeployResult({ ok: m.ok, error: m.error, target: m.target });
        refresh();
      }
    });
    const poll = setInterval(refresh, 3000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [refresh]);

  const act = async (a: "start" | "stop" | "restart") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.action(a);
      if (!r.ok) setError(r.error || "操作失败");
      await new Promise((r2) => setTimeout(r2, 500));
      await refresh();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  return (
    <div className="app">
      <Sidebar env={env} page={page} onNavigate={setPage} />
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>DeepSeek Harness 启动器</h1>
            <p className="sub">
              {page === "overview"
                ? "dsh 开发环境多功能控制台"
                : page === "deploy"
                  ? "dsh 独立目录 · 一键部署"
                  : "dsh 更新 · 检查 Releases 与版本升级"}
              <span className="badge-mvp">MVP</span>
            </p>
          </div>
          <StatusPill status={status} />
        </header>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
              关闭
            </button>
          </div>
        )}

        {page === "overview" ? (
          <section className="cards">
            <ServerCard status={status} busy={busy} onAction={act} onOpen={(t) => api.open(t)} />
            <EnvCard env={env} />
          </section>
        ) : page === "deploy" ? (
          <DeployCard env={env} busy={busy} setBusy={setBusy} deployResult={deployResult} />
        ) : (
          <UpdateCard busy={busy} setBusy={setBusy} deployResult={deployResult} />
        )}

        <LogsPanel logs={logs} />
      </main>
    </div>
  );
}
