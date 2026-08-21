import type { ServerStatus } from "../api";

function stateOf(s: ServerStatus | null): { label: string; cls: string } {
  if (!s) return { label: "连接中…", cls: "idle" };
  if (s.busy) return { label: "操作中…", cls: "busy" };
  if (s.running && s.httpOk) return { label: `运行中 · :${s.port}`, cls: "ok" };
  if (s.running) return { label: `启动中 · :${s.port}`, cls: "warn" };
  return { label: "已停止", cls: "idle" };
}

export function StatusPill({ status }: { status: ServerStatus | null }) {
  const s = stateOf(status);
  return (
    <div className={`status-pill ${s.cls}`}>
      <span className="dot" />
      {s.label}
    </div>
  );
}
