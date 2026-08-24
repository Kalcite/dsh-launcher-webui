import { useState } from "react";
import { Cpu, Save, RotateCcw, Home, FolderOpen } from "lucide-react";
import { api, type EnvInfo } from "../api";

function Row({ k, v, code }: { k: string; v: string | null; code?: boolean }) {
  return (
    <div className="env-row">
      <span className="env-key">{k}</span>
      {code ? <code className="env-val">{v ?? "—"}</code> : <span className="env-val">{v ?? "—"}</span>}
    </div>
  );
}

export function EnvCard({ env }: { env: EnvInfo | null }) {
  const [home, setHome] = useState<string>("");
  const [saved, setSaved] = useState(false);

  const doSaveHome = async () => {
    const trimmed = home.trim();
    const r = await api.saveConfig({ dshHome: trimmed === "" || trimmed === "default" ? null : trimmed });
    if (r.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const pickHome = async () => {
    try {
      const r = await api.pickDir();
      if (r.ok && r.path) setHome(r.path);
    } catch {
      /* 用户取消或对话框失败：忽略 */
    }
  };

  return (
    <section className="card env-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <Cpu size={17} />
          </span>
          <div>
            <h2>开发环境</h2>
            <p className="sub">工具链与 dsh 部署信息</p>
          </div>
        </div>
      </div>

      {env ? (
        <div className="env-list">
          <Row k="node" v={env.node} code />
          <Row k="pnpm" v={env.pnpm} code />
          <Row k="git" v={env.git} code />
          <Row k="便携 Node (.runtime)" v={env.portableNode ?? "未安装"} code />
          <Row k="便携 pnpm (.runtime)" v={env.portablePnpm ?? "未安装"} code />
          <Row k="dsh 根目录" v={env.dshRoot} />
          <Row k="web 端口" v={String(env.webPort)} code />
          <Row k="profile" v={env.profile ?? "web"} code />
        </div>
      ) : (
        <p className="placeholder">正在读取环境信息…</p>
      )}

      {/* DSH_HOME：dsh 用户数据根，可指向项目目录（如 ./.dsh 或 D:/dsh-home） */}
      <div className="home-box">
        <div className="home-head">
          <span className="home-title"><Home size={13} /> 数据目录 DSH_HOME</span>
          <span className="home-current">{env?.dshHome ?? "~/.dsh（默认）"}</span>
        </div>
        <div className="form-row">
          <div className="filter-box grow">
            <Home size={14} />
            <input
              value={home}
              onChange={(e) => setHome(e.target.value)}
              placeholder="留空=默认 ~/.dsh；./.dsh = dshRoot 下；或绝对路径"
              spellCheck={false}
              className="grow-input"
            />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={pickHome} title="打开文件夹选择器">
            <FolderOpen size={14} /> 浏览…
          </button>
          <button className="btn btn-ghost btn-sm" onClick={doSaveHome} title="保存 DSH_HOME（重启 dsh 服务器后生效）">
            <Save size={13} /> 保存
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setHome("");
              api.saveConfig({ dshHome: null });
            }}
            title="恢复默认 ~/.dsh"
          >
            <RotateCcw size={13} /> 恢复默认
          </button>
        </div>
        <p className="hint">
          profile / 插件 / 会话 / 凭据 / 预设等全部跟随所选目录（独立于用户文件夹）。<b>切换后需重启 dsh 服务器生效。</b>
          {saved && <span className="saved-tag">已保存 ✓</span>}
        </p>
      </div>
    </section>
  );
}
