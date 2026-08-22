import { useCallback, useEffect, useRef, useState } from "react";
import { ListTodo, FolderOpen, Undo2, RefreshCw, AlertTriangle } from "lucide-react";
import { api, type EventRecord } from "../api";

type Props = {
  busy: boolean;
  setBusy: (b: boolean) => void;
  deployResult: { ok: boolean; error?: string; target?: string } | null;
};

const LEVELS = [
  { key: "all", label: "全部" },
  { key: "error", label: "错误" },
  { key: "warn", label: "警告" },
  { key: "info", label: "正常" }
] as const;

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

export function EventsCard({ busy, setBusy, deployResult }: Props) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [lastOp, setLastOp] = useState<{ kind: string; ts: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.eventsList(0);
      lastSeq.current = r.nextSeq;
      setEvents(r.events);
      setLastOp(r.lastOp);
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "event") {
          lastSeq.current = m.event.seq;
          setEvents((prev) => [...prev.slice(-2000), m.event as EventRecord]);
        }
      } catch { /* 心跳 */ }
    };
    return () => es.close();
  }, [load]);

  // 恢复操作完成（SSE deploy action=recover）→ 提示
  useEffect(() => {
    if (deployResult) {
      if (deployResult.ok) setNotice("恢复完成（重启 dsh 后生效）");
      else setError(deployResult.error || "恢复失败");
      load();
    }
  }, [deployResult, load]);

  const doRecover = async () => {
    if (!lastOp) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.recover(lastOp.kind as "update" | "plugin");
      if (!r.ok) setError(r.error || "恢复启动失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const visible = filter === "all" ? events : events.filter((e) => e.level === filter);
  const errCount = events.filter((e) => e.level === "error").length;
  const warnCount = events.filter((e) => e.level === "warn").length;

  return (
    <section className="card deploy-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <ListTodo size={17} />
          </span>
          <div>
            <h2>事件管理器</h2>
            <p className="sub">
              记录 webui 与 dsh 的事件：正常日志不标注 · 警告<span className="ev-dot warn" />黄 · 错误<span className="ev-dot err" />红
            </p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} title="刷新">
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      <div className="ev-toolbar">
        <div className="ev-filters">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              className={`btn btn-sm${filter === l.key ? " btn-primary" : " btn-ghost"}`}
              onClick={() => setFilter(l.key)}
            >
              {l.label}
              {l.key === "error" && errCount > 0 && <em className="ev-count err">{errCount}</em>}
              {l.key === "warn" && warnCount > 0 && <em className="ev-count warn">{warnCount}</em>}
            </button>
          ))}
        </div>
        <div className="ev-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => api.open("logs")} title="打开服务端日志目录 (.dshctl)">
            <FolderOpen size={14} /> 打开日志文件夹
          </button>
          {lastOp && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={doRecover} title={`恢复到操作前（${lastOp.kind === "update" ? "回退 dsh 版本" : "清除插件安装"}）`}>
              <Undo2 size={14} /> 尝试恢复{lastOp.kind === "update" ? "（更新前）" : "（插件安装前）"}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="notice-banner">{notice}</div>}
      {error && <div className="error-banner"><span>{error}</span></div>}

      <div className="ev-list" ref={listRef}>
        {visible.length === 0 ? (
          <div className="logs-empty">暂无事件记录</div>
        ) : (
          visible.map((e) => (
            <div key={e.seq} className={`ev-row ${e.level}`}>
              <span className="ev-time mono">{fmtTime(e.ts)}</span>
              <span className={`ev-level ${e.level}`}>
                {e.level === "error" ? "错误" : e.level === "warn" ? "警告" : "正常"}
              </span>
              <span className="ev-source mono">{e.source}</span>
              <span className="ev-msg">{e.message}</span>
            </div>
          ))
        )}
      </div>
      <p className="hint">
        {errCount > 0 && <><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> 当前有 {errCount} 条错误事件；</>}
        致命错误会弹出提示，可查看日志或尝试恢复。正常启停/重启为 info（不标注）。
      </p>
    </section>
  );
}
