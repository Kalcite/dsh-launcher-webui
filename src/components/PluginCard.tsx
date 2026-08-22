import { useCallback, useEffect, useState } from "react";
import {
  Puzzle,
  Search,
  Download,
  Power,
  PowerOff,
  Trash2,
  Package,
  AlertTriangle,
  RefreshCw,
  ExternalLink
} from "lucide-react";
import { api, type PluginOverview, type PluginSearchResult, type SpecialPlugin } from "../api";

type Props = {
  busy: boolean;
  setBusy: (b: boolean) => void;
  deployResult: { ok: boolean; error?: string; target?: string } | null;
};

function InstalledRow({
  item,
  busy,
  onToggle,
  onRemove
}: {
  item: { name: string; enabled: boolean; builtin?: boolean; dir?: string };
  busy: boolean;
  onToggle: (name: string, disable: boolean) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <div className={`prow${item.enabled ? "" : " disabled"}`}>
      <span className={`pstatus ${item.enabled ? "on" : "off"}`} title={item.enabled ? "启用" : "已禁用"} />
      <div className="pinfo">
        <span className="pname mono">{item.name}</span>
        {item.builtin ? (
          <em className="pbadge builtin">本体自带 · 不可修改</em>
        ) : item.dir ? (
          <em className="pbadge external">外部注入</em>
        ) : (
          <em className="pbadge user">用户安装</em>
        )}
      </div>
      <div className="pops">
        {!item.builtin && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onToggle(item.name, item.enabled)} title={item.enabled ? "禁用（重启生效）" : "启用（重启生效）"}>
            {item.enabled ? <PowerOff size={13} /> : <Power size={13} />} {item.enabled ? "禁用" : "启用"}
          </button>
        )}
        {!item.builtin && (
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => onRemove(item.name)} title="卸载">
            <Trash2 size={13} /> 卸载
          </button>
        )}
      </div>
    </div>
  );
}

export function PluginCard({ busy, setBusy, deployResult }: Props) {
  const [overview, setOverview] = useState<PluginOverview | null>(null);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<PluginSearchResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await api.plugins());
    } catch {
      /* 后端短暂不可用 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 操作完成（SSE deploy 事件）→ 刷新列表 + 提示
  useEffect(() => {
    if (deployResult) {
      if (deployResult.ok) setNotice("操作完成（重启 dsh 后生效）");
      else setError(deployResult.error || "操作失败");
      load();
    }
  }, [deployResult, load]);

  const doSearch = async () => {
    setSearching(true);
    setError(null);
    try {
      setResult(await api.pluginSearch(q.trim()));
    } catch (e) {
      setError(String(e));
    }
    setSearching(false);
  };

  const installNpm = async (pkg: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.pluginInstall({ source: "npm", pkg });
      if (!r.ok) setError(r.error || "安装启动失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const installSpecial = async (spec: { source: "npm" | "routing-suite"; pkg?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.pluginInstall(spec);
      if (!r.ok) setError(r.error || "安装启动失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const toggle = async (name: string, disable: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.pluginToggle(name, disable);
      if (!r.ok) setError(r.error || "操作失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const remove = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.pluginRemove(name);
      if (!r.ok) setError(r.error || "卸载失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const SpecialCard = ({ sp }: { sp: SpecialPlugin }) => (
    <div className="special-card">
      <div className="special-head">
        <Package size={14} />
        <span className="pname mono">{sp.name}</span>
        {sp.needsFix && <em className="pbadge fix">需二次修复</em>}
        <a className="github-link" href={sp.url} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> GitHub
        </a>
      </div>
      <p className="special-desc">{sp.description}</p>
      {sp.needsFix && (
        <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === sp.key ? null : sp.key)}>
          {expanded === sp.key ? "收起" : "查看修复说明"} <AlertTriangle size={12} />
        </button>
      )}
      {expanded === sp.key && <p className="hint">{sp.fixNote}</p>}
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => installSpecial(sp.install)}>
          <Download size={13} /> 安装 {sp.name}
        </button>
      </div>
    </div>
  );

  return (
    <section className="card deploy-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <Puzzle size={17} />
          </span>
          <div>
            <h2>插件管理</h2>
            <p className="sub">
              profile: {overview?.profile ?? "web"} · {overview?.profileDir ?? "…"}
            </p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} title="刷新列表">
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {/* 已安装（含本体自带） */}
      <h3 className="section-title">已安装插件（本体自带不可修改）</h3>
      <div className="plugin-list">
        {overview?.installed.length ? (
          overview.installed.map((p) => (
            <InstalledRow key={p.name} item={p} busy={busy} onToggle={toggle} onRemove={remove} />
          ))
        ) : (
          <p className="hint">暂无已安装插件</p>
        )}
        {overview?.external.map((p) => (
          <InstalledRow key={p.name + "-ext"} item={{ ...p, dir: p.dir }} busy={busy} onToggle={toggle} onRemove={remove} />
        ))}
      </div>

      {/* 搜索 npm */}
      <h3 className="section-title">搜索插件（npm · @deepseek-ai/ 系列）</h3>
      <div className="form-row">
        <div className="filter-box grow">
          <Search size={14} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="精确：dsh-bash-sandbox（完全匹配）｜模糊：sandbox（名称/描述包含）｜留空列出全部"
            spellCheck={false}
            className="grow-input"
          />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={doSearch} disabled={searching}>
          <Search size={14} /> 搜索
        </button>
      </div>
      {result?.error && (
        <div className="error-banner">
          <span><AlertTriangle size={13} /> 搜索失败：{result.error}</span>
        </div>
      )}
      {result && (
        <div className="plugin-list search-list">
          {result.npm.length === 0 ? (
            <p className="hint">未找到匹配的 @deepseek-ai 插件</p>
          ) : (
            result.npm.map((p) => (
              <div key={p.name} className="prow">
                <span className="pstatus on" />
                <div className="pinfo">
                  <span className="pname mono">{p.name}</span>
                  <span className="pver mono">v{p.version}</span>
                  {p.description && <span className="pdesc">{p.description}</span>}
                </div>
                <div className="pops">
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => installNpm(p.name)}>
                    <Download size={13} /> 安装
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 特殊插件 */}
      <h3 className="section-title">特殊插件（GitHub 来源）</h3>
      <div className="plugin-list">
        {(result?.special ?? overview?.special ?? []).map((sp) => (
          <SpecialCard key={sp.key} sp={sp} />
        ))}
      </div>

      {notice && <div className="notice-banner">{notice}</div>}
      {error && <div className="error-banner"><span>{error}</span></div>}
      {busy && <p className="hint">执行中… 进度实时显示在下方的服务器日志面板（SSE 推送）。</p>}
    </section>
  );
}
