import { useEffect, useRef, useState, useCallback } from "react";
import { Sun, Moon } from "lucide-react";
import { api, connectSse, type ServerStatus, type EnvInfo, type LogEntry, type FatalInfo } from "./api";
import { Sidebar, type Page } from "./components/Sidebar";
import { StatusPill } from "./components/StatusPill";
import { ServerCard } from "./components/ServerCard";
import { EnvCard } from "./components/EnvCard";
import { DeployCard } from "./components/DeployCard";
import { UpdateCard } from "./components/UpdateCard";
import { PluginCard } from "./components/PluginCard";
import { EventsCard } from "./components/EventsCard";
import { SettingsCard } from "./components/SettingsCard";
import { UsageCard } from "./components/UsageCard";
import { ErrorModal } from "./components/ErrorModal";
import { LogsPanel } from "./components/LogsPanel";

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<{ ok: boolean; error?: string; target?: string } | null>(null);
  const [fatal, setFatal] = useState<FatalInfo | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return (localStorage.getItem("dsh-theme") as "dark" | "light") || "dark"; } catch { return "dark"; }
  });
  const lastSeq = useRef(0);

  // 主题切换：设置 <html data-theme> + localStorage 持久化
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("dsh-theme", theme); } catch { /* 忽略 */ }
  }, [theme]);

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
      } else if (m.type === "fatal") {
        // 致命错误：终止导致错误的进程（后端已清理）+ 弹出错误提示
        setFatal({ kind: m.kind, message: m.message, recoverable: m.recoverable });
      }
    });
    const poll = setInterval(refresh, 3000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [refresh]);

  const doRecover = async (kind: "update" | "plugin") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.recover(kind);
      if (!r.ok) setError(r.error || "恢复启动失败");
      else setFatal(null); // 恢复开始，关闭弹窗（进度走日志面板）
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

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
                  ? "dsh 独立目录 · 部署/切换/管理"
                  : page === "plugins"
                    ? "已安装插件 · npm 搜索 · 特殊插件"
                    : page === "events"
                      ? "事件记录 · 日志查看 · 错误恢复"
                      : page === "settings"
                        ? "基本参数 · 启动器更新"
                        : page === "usage"
                          ? "Token 消耗 · 计费账单 · 热力图"
                          : "dsh 更新 · 检查 Releases 与版本升级"}
              <span className="badge-mvp">MVP</span>
            </p>
          </div>
          <div className="topbar-right">
            <button
              className="btn btn-ghost btn-sm theme-toggle"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "切换到白天主题" : "切换到黑夜主题"}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              {theme === "dark" ? "白天" : "黑夜"}
            </button>
            <StatusPill status={status} />
          </div>
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
        ) : page === "plugins" ? (
          <PluginCard busy={busy} setBusy={setBusy} deployResult={deployResult} />
        ) : page === "events" ? (
          <EventsCard busy={busy} setBusy={setBusy} deployResult={deployResult} />
        ) : page === "settings" ? (
          <SettingsCard env={env} busy={busy} setBusy={setBusy} deployResult={deployResult} />
        ) : page === "usage" ? (
          <UsageCard />
        ) : (
          <UpdateCard busy={busy} setBusy={setBusy} deployResult={deployResult} />
        )}

        <LogsPanel logs={logs} />
      </main>

      {/* 全局致命错误弹窗 */}
      <ErrorModal fatal={fatal} busy={busy} onRecover={doRecover} onClose={() => setFatal(null)} />
    </div>
  );
}
