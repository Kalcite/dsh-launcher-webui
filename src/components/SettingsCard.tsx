import { useEffect, useState } from "react";
import { Settings, Save, RefreshCw, Download, AlertTriangle, Package, Archive, Trash2 } from "lucide-react";
import { api, type EnvInfo } from "../api";

type Props = {
  env: EnvInfo | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  deployResult: { ok: boolean; error?: string; target?: string } | null;
};

export function SettingsCard({ env, busy, setBusy, deployResult }: Props) {
  const [webPort, setWebPort] = useState("");
  const [launcherPort, setLauncherPort] = useState("");
  const [profile, setProfile] = useState("");
  const [saved, setSaved] = useState(false);
  const [check, setCheck] = useState<Awaited<ReturnType<typeof api.launcherCheck>> | null>(null);
  const [checking, setChecking] = useState(false);
  const [backups, setBackups] = useState<{ id: string; ts: number; reason: string; files: number; size: number; skipped?: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBackups = async () => {
    try {
      const r = await api.backupList();
      setBackups(r.backups);
    } catch { /* 忽略 */ }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const doBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.backup("手动备份");
      if (!r.ok) setError(r.error || "备份失败");
      else setNotice(`会话已备份（${r.id}）`);
      await loadBackups();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const doDeleteBackup = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.backupDelete(id);
      if (!r.ok) setError(r.error || "删除失败");
      await loadBackups();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  useEffect(() => {
    if (env) {
      setWebPort(String(env.webPort ?? ""));
      setLauncherPort(String(env.launcherPort ?? "5177"));
      setProfile(env.profile ?? "");
    }
  }, [env]);

  // 启动器更新完成（SSE deploy action=launcher-update）→ 提示
  useEffect(() => {
    if (deployResult) {
      if (deployResult.ok) setNotice("基本更新完成！前端已即时生效。请重启启动器（launcher.cmd）完成剩余更新。");
      else setError(deployResult.error || "更新失败");
    }
  }, [deployResult]);

  const doSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.saveConfig({
        webPort: Number(webPort) || undefined,
        launcherPort: Number(launcherPort) || undefined,
        profile: profile.trim() || null
      });
      if (!r.ok) setError("保存失败");
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        setNotice("已保存（下次启动生效：launcherPort 变更需重启启动器，webPort 变更下次启动 dsh 时生效）");
      }
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const doCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await api.launcherCheck());
    } catch (e) {
      setError(String(e));
    }
    setChecking(false);
  };

  const doUpdate = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.launcherUpdate();
      if (!r.ok) setError(r.error || "更新启动失败");
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  return (
    <section className="card deploy-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <Settings size={17} />
          </span>
          <div>
            <h2>启动器设置</h2>
            <p className="sub">基本参数与变量 · 检查启动器更新（更新不中断当前进程，重启完成收尾）</p>
          </div>
        </div>
      </div>

      {/* 基本参数 */}
      <h3 className="section-title">基本参数（下次启动生效）</h3>
      <div className="set-grid">
        <label className="set-field">
          <span>dsh 启动端口（webPort）</span>
          <input value={webPort} onChange={(e) => setWebPort(e.target.value)} spellCheck={false} className="grow-input mono" />
        </label>
        <label className="set-field">
          <span>WebUI 启动端口（launcherPort）</span>
          <input value={launcherPort} onChange={(e) => setLauncherPort(e.target.value)} spellCheck={false} className="grow-input mono" />
        </label>
        <label className="set-field">
          <span>dsh profile</span>
          <input value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="web" spellCheck={false} className="grow-input mono" />
        </label>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy} onClick={doSave}>
          <Save size={15} /> 保存
        </button>
        {saved && <span className="saved-tag">已保存 ✓</span>}
      </div>
      <p className="hint">
        端口变更在下次启动时生效；当前会话继续使用旧端口。dsh 本体目录（dshRoot）与数据目录（dshHome）见「概览」页。
      </p>

      {/* 启动器更新 */}
      <h3 className="section-title" style={{ marginTop: 18 }}>启动器更新</h3>
      <div className="launcher-update">
        <div className="lu-row">
          <span className="lu-label"><Package size={13} /> 当前版本</span>
          <span className="lu-value mono">v{env?.launcherVersion ?? check?.current ?? "?"}</span>
        </div>
        <div className="lu-row">
          <span className="lu-label">最新版本</span>
          <span className="lu-value mono">{check?.latest ? check.latest.tag : check?.error ? "获取失败" : "—"}</span>
        </div>
        <div className="lu-row">
          <span className="lu-label">安装方式</span>
          <span className="lu-value mono">{check?.mode === "zip" ? "zip 源码包" : check?.mode === "git" ? "git 仓库" : "—"}</span>
        </div>
        {check?.hasUpdate && (
          <div className="notice-banner" style={{ marginTop: 8 }}>
            <AlertTriangle size={13} /> 发现新版本 {check.latest?.tag}（当前 v{check.current}）
          </div>
        )}
        {check?.latest && check.latest.body && (
          <details className="lu-body">
            <summary>查看更新内容</summary>
            <pre>{check.latest.body}</pre>
          </details>
        )}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" disabled={checking} onClick={doCheck}>
            <RefreshCw size={14} /> 检查更新
          </button>
          <button className="btn btn-primary" disabled={busy || !check?.hasUpdate} onClick={doUpdate} title={check?.mode === "zip" ? "下载最新源码包 → install/build → 替换（保留 config.json 与数据），重启生效" : "分步更新：git pull + install + build，不中断当前进程；重启完成剩余更新"}>
            <Download size={14} /> 更新启动器
          </button>
        </div>
        <p className="hint">
          {check?.mode === "zip"
            ? <>更新采用<b>源码包模式</b>：下载最新 Release 源码包 → 安装依赖 → 重建前端并<b>整体替换</b>（保留 config.json / 备份数据 / 内置运行时），<b>不终止当前进程</b>；完成后重启启动器生效。</>
            : <>更新采用<b>分步执行</b>：拉取源码（detached HEAD 自动切回 master）→ 安装依赖 → 重建前端（即时生效），<b>不终止当前进程</b>；基本更新完成后提示重启，重启时自动完成剩余内容并清除标记。</>}
        </p>
      </div>

      {/* 会话备份 */}
      <h3 className="section-title" style={{ marginTop: 18 }}>会话备份（升级 dsh/插件前自动执行）</h3>
      <div className="launcher-update">
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={doBackup}>
            <Archive size={14} /> 手动备份会话
          </button>
        </div>
        <p className="hint">
          备份 ~/.dsh/sessions 到 启动器目录 .dshctl/&lt;dsh 本体&gt;/backups/（按 dsh 区分，不写入 dsh 本体目录）；dsh 升级与插件安装/更新/卸载前自动备份，用于回退保护。
        </p>
        <div className="backup-list">
          {backups.length === 0 ? (
            <p className="hint">暂无备份记录</p>
          ) : (
            backups
              .slice()
              .reverse()
              .map((b) => (
                <div key={b.id} className="lu-row">
                  <span className="lu-label" title={b.reason}>
                    <Archive size={12} /> {new Date(b.ts).toLocaleString("zh-CN", { hour12: false })}
                    {b.skipped ? "（无会话目录）" : ` · ${(b.size / 1024).toFixed(1)} KB / ${b.files} 文件`}
                  </span>
                  <span className="lu-value" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{b.reason}</span>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => doDeleteBackup(b.id)} title="删除此备份">
                    <Trash2 size={12} /> 删除
                  </button>
                </div>
              ))
          )}
        </div>
      </div>

      {notice && <div className="notice-banner">{notice}</div>}
      {error && <div className="error-banner"><span>{error}</span></div>}
      {busy && <p className="hint">执行中… 进度实时显示在下方的服务器日志面板（SSE 推送）。</p>}
    </section>
  );
}
