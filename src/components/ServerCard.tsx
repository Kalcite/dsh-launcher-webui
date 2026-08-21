import { Play, Square, RotateCcw, ExternalLink, FolderOpen, Code2, Server, Activity } from "lucide-react";
import type { ServerStatus } from "../api";

type Props = {
  status: ServerStatus | null;
  busy: boolean;
  onAction: (a: "start" | "stop" | "restart") => void;
  onOpen: (t: "web" | "folder" | "vscode") => void;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString("zh-CN", { hour12: false });
}

export function ServerCard({ status, busy, onAction, onOpen }: Props) {
  const s = status;
  const disabled = busy || !s || s.busy;

  return (
    <section className="card server-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <Server size={17} />
          </span>
          <div>
            <h2>dsh Web 服务器</h2>
            <p className="sub">
              {s?.port ? `端口 ${s.port}` : "…"} · {s?.profile ? `profile ${s.profile}` : "profile web"}
            </p>
          </div>
        </div>
        <span className={`live-dot ${s?.running ? "on" : "off"}`} title={s?.running ? "运行中" : "已停止"} />
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">
            <Activity size={13} /> 状态
          </span>
          <span className={`stat-value ${s?.httpOk ? "ok" : s?.running ? "warn" : ""}`}>
            {s?.running ? (s.httpOk ? "运行中 · HTTP 200" : "启动中…") : "已停止"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">PID</span>
          <span className="stat-value mono">{s?.pid ?? "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">启动于</span>
          <span className="stat-value mono">{fmtTime(s?.startedAt ?? null)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">日志大小</span>
          <span className="stat-value mono">
            {s?.logSize != null ? `${(s.logSize / 1024).toFixed(1)} KB` : "—"}
          </span>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" disabled={disabled || s?.running} onClick={() => onAction("start")}>
          <Play size={15} /> 启动
        </button>
        <button className="btn btn-danger" disabled={disabled || !s?.running} onClick={() => onAction("stop")}>
          <Square size={14} /> 停止
        </button>
        <button className="btn btn-ghost" disabled={disabled} onClick={() => onAction("restart")}>
          <RotateCcw size={14} /> 重启
        </button>
      </div>

      <div className="btn-row quick">
        <button className="btn btn-ghost btn-sm" onClick={() => onOpen("web")} title="浏览器打开 Web UI">
          <ExternalLink size={14} /> 打开 Web UI
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onOpen("folder")} title="打开仓库目录">
          <FolderOpen size={14} /> 仓库目录
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onOpen("vscode")} title="在 VSCode 打开仓库">
          <Code2 size={14} /> 在 VSCode 打开
        </button>
      </div>
    </section>
  );
}
