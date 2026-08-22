import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal, Trash2, Filter } from "lucide-react";
import type { LogEntry } from "../api";

export function LogsPanel({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [clearSeq, setClearSeq] = useState<number | null>(null); // 清空视图 = 只显示此 seq 之后的行
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const visible = useMemo(() => {
    let list = logs;
    if (clearSeq !== null) list = list.filter((e) => e.seq > clearSeq);
    const kw = filter.trim().toLowerCase();
    if (kw) list = list.filter((e) => e.line.toLowerCase().includes(kw));
    return list;
  }, [logs, filter, clearSeq]);

  // 自动滚动：仅在用户停留在底部时跟随
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    // 只滚动日志列表自身容器，避免 scrollIntoView 把外层页面也拉到底部
    if (autoScroll && stick.current) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [visible.length, autoScroll]);

  return (
    <section className="card logs-card">
      <div className="card-head logs-head">
        <div className="card-title">
          <span className="icon-box">
            <Terminal size={17} />
          </span>
          <div>
            <h2>服务器日志</h2>
            <p className="sub">
              {visible.length} 行可见 · 实时 SSE 推送{clearSeq !== null ? "（已清空视图）" : ""}
            </p>
          </div>
        </div>
        <div className="logs-tools">
          <div className="filter-box">
            <Filter size={13} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤日志…"
              spellCheck={false}
            />
          </div>
          <label className="auto-scroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            跟随
          </label>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setClearSeq(logs.length ? logs[logs.length - 1].seq : 0)}
          >
            <Trash2 size={13} /> 清空视图
          </button>
        </div>
      </div>

      <div className="logs-body" ref={listRef} onScroll={onScroll}>
        {visible.length === 0 ? (
          <div className="logs-empty">暂无日志 — 启动服务器后输出会实时显示在这里</div>
        ) : (
          visible.map((e) => (
            <div
              key={e.seq}
              className={`log-line${
                e.line.startsWith("[stderr]")
                  ? " stderr"
                  : e.line.startsWith("[launcher]")
                    ? " launcher"
                    : ""
              }${e.level === "error" ? " error" : e.level === "warn" ? " warn" : ""}`}
            >
              <span className="log-seq">{String(e.seq % 10000).padStart(4, "0")}</span>
              <span className="log-text">{e.line}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
