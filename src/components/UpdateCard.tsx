import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Download,
  Wrench,
  GitBranch,
  GitCommit,
  Package,
  Tag,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  AlertTriangle
} from "lucide-react";
import { api, type UpdateCheck } from "../api";

type Props = {
  busy: boolean;
  setBusy: (b: boolean) => void;
  deployResult: { ok: boolean; error?: string; target?: string } | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function UpdateCard({ busy, setBusy, deployResult }: Props) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const doCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.updateCheck();
      setCheck(r);
      if (r.releases.length > 0) setSelected(r.releases[0].tag);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    doCheck();
  }, [doCheck]);

  // 后端更新完成（SSE deploy 事件，action=update）
  useEffect(() => {
    if (deployResult) {
      if (deployResult.ok) {
        setNotice(`更新完成！当前：${deployResult.target ?? "最新"}`);
        setError(null);
        doCheck();
      } else {
        setError(deployResult.error || "更新失败，请查看日志");
      }
    }
  }, [deployResult, doCheck]);

  const apply = async (version: string | null) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.updateApply(version ? { version } : {});
      if (!r.ok) setError(r.error || "更新启动失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const repair = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.updateRepair();
      if (!r.ok) setError(r.error || "修复启动失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const cur = check?.current;
  const isCurrent = (tag: string) => cur?.tag === tag;
  const bundles = check?.clientBundles;
  const bundlesBroken = (bundles?.missing.length ?? 0) > 0;

  return (
    <section className="card deploy-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <RefreshCw size={17} />
          </span>
          <div>
            <h2>更新 dsh</h2>
            <p className="sub">检查 GitHub releases 更新内容 · 选择版本升级（默认最新）</p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={doCheck} disabled={loading}>
          <RefreshCw size={14} /> 检查更新
        </button>
      </div>

      {/* 预览版破坏性更新警告 */}
      <div className="error-banner" style={{ marginBottom: 14 }}>
        <span>
          <AlertTriangle size={13} /> ⚠ dsh 处于<strong>开发者预览版（Developer Preview）</strong>阶段，版本间可能存在<strong>破坏性更新</strong>，
          贸然升级可能造成致命影响（配置/会话/插件不兼容）。
          升级前将<strong>自动备份会话数据</strong>（~/.dsh/sessions）；升级后自动<strong>启动验证插件兼容性</strong>。
          如需回退，可在弹窗或事件管理器中使用「尝试恢复」。
        </span>
      </div>

      {/* 版本组合与备用端提示（v0.8.0+） */}
      <div className="notice-banner" style={{ marginBottom: 14 }}>
        <span>
          <AlertTriangle size={13} /> 当前登记组合：dsh <strong>dsh-v0.1.3-alpha.1</strong> ↔ 启动器 v0.8+ ↔ 插件{" "}
          <strong>dsh-better-sidebar@≥0.18</strong>（已移除对 <code>settingsNamespace</code> 的依赖）。
          升级前请确认：① 插件与新版 dsh 兼容（2026-09-04 事故：旧版 sidebar 在新版 dsh 上<strong>启动即退 code=1</strong>）；
          ② Router 预设需经 v0.7.7+ 重装以适配 Session API；③ 升级后若主端异常，可在「概览 → 备用服务器」启动固定版本{" "}
          <code>dsh-v0.1.3-alpha.1</code> 的备用端进入修复（vibecoding 式自愈，不依赖主端可用）。
        </span>
      </div>

      {/* 当前版本 */}
      <div className="deploy-status">
        <div className="drow">
          <span className="drow-label"><GitBranch size={13} /> 当前分支</span>
          <span className="drow-value mono">{cur?.branch ?? "—"}</span>
        </div>
        <div className="drow">
          <span className="drow-label"><GitCommit size={13} /> 当前提交</span>
          <span className="drow-value mono">{cur?.commit ?? "—"}</span>
        </div>
        <div className="drow">
          <span className="drow-label"><Tag size={13} /> 最近版本标签</span>
          <span className="drow-value mono">{cur?.tag ?? "（无标签）"}</span>
        </div>
        <div className="drow">
          <span className="drow-label"><Package size={13} /> package.json 版本</span>
          <span className="drow-value mono">{cur?.pkgVersion ?? "—"}</span>
        </div>
      </div>

      {check?.error && (
        <div className="error-banner">
          <span><AlertTriangle size={13} /> Releases 同步失败：{check.error}</span>
        </div>
      )}

      {/* 客户端 bundle 健康（bundle script failed to load 的根源）+ 全量修复入口 */}
      {bundles && (
        <div className={`bundle-health${bundlesBroken ? " broken" : " ok"}`}>
          <span className="bundle-health-label">
            {bundlesBroken ? (
              <><AlertTriangle size={13} /> 环境构建异常：缺失 {bundles.missing.length}/{bundles.total} 个（含前端 web dist / 客户端 bundle）</>
            ) : (
              <>环境构建完整（{bundles.total} 个，含前端 web dist）</>
            )}
          </span>
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={repair} title="不碰 git，clean + 全量构建（含前端 apps/web dist 与客户端 bundle），修复网页未构建 / bundle script failed to load">
            <Wrench size={13} /> 修复环境构建（全量）
          </button>
        </div>
      )}
      {!bundlesBroken && bundles && bundles.total > 0 && (
        <p className="hint">
          若浏览器出现 "bundle script ... failed to load" 或 dsh 启动报 "frontend dist not built"，可点击「修复环境构建（全量）」（clean + 全量构建，不碰 git）。
        </p>
      )}

      {/* 版本列表 */}
      <h3 className="section-title">可用版本（GitHub Releases，按发布时间倒序）</h3>
      {check && check.releases.length === 0 ? (
        <p className="hint">{check.error ? "无法获取 release 列表" : "暂无可用 release"}</p>
      ) : (
        <div className="release-list">
          {check?.releases.map((r) => (
            <div
              key={r.tag}
              className={`release-item${selected === r.tag ? " selected" : ""}${isCurrent(r.tag) ? " current" : ""}`}
              onClick={() => setSelected(r.tag)}
            >
              <div className="release-head">
                <input
                  type="radio"
                  name="release"
                  checked={selected === r.tag}
                  onChange={() => setSelected(r.tag)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="release-tag mono">{r.tag}</span>
                {r.prerelease && <em className="pre-badge">pre-release</em>}
                {isCurrent(r.tag) && <em className="cur-badge">当前版本</em>}
                <span className="release-name">{r.name}</span>
                <span className="release-date"><CalendarDays size={12} /> {fmtDate(r.publishedAt)}</span>
                <button
                  className="btn btn-ghost btn-sm expand-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(expanded === r.tag ? null : r.tag);
                  }}
                  title="展开/收起更新内容"
                >
                  {expanded === r.tag ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {expanded === r.tag && (
                <div className="release-body">
                  {r.body.trim() ? <pre>{r.body}</pre> : <p className="hint">（无更新内容）</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={busy || loading || !selected || isCurrent(selected)}
          onClick={() => apply(selected)}
          title={isCurrent(selected) ? "当前已是最新选择的版本" : "fetch 指定版本标签 + install + build"}
        >
          <Download size={15} /> 更新到 {selected || "…"}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || loading}
          onClick={() => apply(null)}
          title="取消固定版本，更新到远端最新 master"
        >
          <RefreshCw size={14} /> 更新到最新 master
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || loading}
          onClick={repair}
          title="不碰 git，clean + 全量构建（含前端 apps/web dist 与客户端 bundle），修复网页未构建 / bundle script failed to load"
        >
          <Wrench size={14} /> 修复环境构建（全量）
        </button>
      </div>
      {notice && <div className="notice-banner">{notice}</div>}
      {error && <div className="error-banner"><span>{error}</span></div>}
      {busy && <p className="hint">更新执行中… 进度实时显示在下方的服务器日志面板（SSE 推送）。</p>}
    </section>
  );
}
