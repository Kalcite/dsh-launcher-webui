import { useCallback, useEffect, useState } from "react";
import {
  Rocket,
  FolderSearch,
  FolderOpen,
  CheckCircle2,
  XCircle,
  GitBranch,
  GitCommit,
  Package,
  FolderTree,
  Boxes,
  Hammer,
  DoorOpen
} from "lucide-react";
import { api, type DeployStatus, type EnvInfo } from "../api";

type Props = {
  env: EnvInfo | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  deployResult: { ok: boolean; error?: string; target?: string } | null;
};

function Row({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok?: boolean }) {
  return (
    <div className="drow">
      <span className="drow-label">{icon} {label}</span>
      {ok !== undefined ? (
        ok ? (
          <span className="drow-value ok"><CheckCircle2 size={13} /> {value}</span>
        ) : (
          <span className="drow-value bad"><XCircle size={13} /> {value}</span>
        )
      ) : (
        <span className="drow-value mono">{value}</span>
      )}
    </div>
  );
}

export function DeployCard({ env, busy, setBusy, deployResult }: Props) {
  const [dir, setDir] = useState("");
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 后端部署完成（SSE deploy 事件）→ 显示结果并刷新状态
  useEffect(() => {
    if (deployResult) {
      if (deployResult.ok) {
        setNotice(`部署完成！dshRoot 已切换 → ${deployResult.target}`);
        setError(null);
      } else {
        setError(deployResult.error || "部署失败，请查看日志");
      }
    }
  }, [deployResult]);

  const current = env?.dshRoot ?? "";

  const check = useCallback(async (target?: string) => {
    setError(null);
    try {
      setStatus(await api.deployStatus(target || undefined));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // 自动检查仅跟随 dshRoot 配置变化（字符串引用），避免 3s env 轮询覆盖手动检查结果
  useEffect(() => {
    if (env?.dshRoot) check();
  }, [env?.dshRoot, check]);

  // Windows 原生文件夹选择：选完自动填入并立即检查
  const pick = async () => {
    try {
      const r = await api.pickDir();
      if (r.ok && r.path) {
        setDir(r.path);
        check(r.path);
      }
    } catch {
      /* 用户取消或对话框失败：忽略 */
    }
  };

  const doDeploy = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.deploy({ targetDir: dir.trim() || undefined });
      if (!r.ok) setError(r.error || "部署失败");
      else setNotice("部署完成！已切换 dshRoot 到新目录。");
      await check();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const switchTo = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.saveConfig({ dshRoot: dir.trim() || current });
      if (!r.ok) setError("切换失败");
      else setNotice(`已切换 dshRoot → ${r.dshRoot}`);
      await check();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const st = status;

  return (
    <section className="card deploy-card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <Rocket size={17} />
          </span>
          <div>
            <h2>一键部署 dsh</h2>
            <p className="sub">
              dsh 本体独立存放，可自由选择目录 · 部署 = 克隆仓库 + 便携 Node + pnpm install + build
            </p>
          </div>
        </div>
      </div>

      <div className="form-row">
        <div className="filter-box grow">
          <FolderTree size={14} />
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder={current || "目标目录（如 ../dsh 或 D:/dsh）"}
            spellCheck={false}
            className="grow-input"
          />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={pick} title="打开文件夹选择器">
          <FolderOpen size={14} /> 浏览…
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => check(dir.trim() || undefined)} title="检查该目录状态">
          <FolderSearch size={14} /> 检查
        </button>
      </div>

      <div className="deploy-status">
        <Row icon={<DoorOpen size={13} />} label="当前 dshRoot" value={current} />
        <Row icon={<GitBranch size={13} />} label="git 分支" value={st?.gitBranch ?? "—"} />
        <Row icon={<GitCommit size={13} />} label="提交" value={st?.gitCommit ?? "—"} />
        <Row icon={<Package size={13} />} label="版本 (package.json)" value={st?.pkgVersion ?? "—"} />
        <Row icon={<Boxes size={13} />} label="依赖 (node_modules)" value={st?.hasNodeModules ? "已安装" : "未安装"} ok={st?.hasNodeModules} />
        <Row icon={<Hammer size={13} />} label="构建 (apps/web/dist)" value={st?.hasWebDist ? "已构建" : "未构建"} ok={st?.hasWebDist} />
        <Row
          icon={<CheckCircle2 size={13} />}
          label="部署状态"
          value={st?.deployed ? `已就绪（${st.dshRoot}）` : st?.exists ? "目录存在但未完成部署" : "尚未部署"}
          ok={st?.deployed}
        />
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy || !dir.trim()} onClick={doDeploy} title="克隆仓库 + 安装依赖 + 构建，完成后切换 dshRoot">
          <Rocket size={15} /> 一键部署到此目录
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || !st?.deployed || (dir.trim() !== "" && dir.trim() === current)}
          onClick={switchTo}
          title="把当前 dshRoot 切换为输入目录"
        >
          <DoorOpen size={14} /> 切换到此目录
        </button>
      </div>

      {notice && <div className="notice-banner">{notice}</div>}
      {error && <div className="error-banner"><span>{error}</span></div>}
      {busy && <p className="hint">执行中… 进度实时显示在下方的服务器日志面板（SSE 推送）。</p>}
    </section>
  );
}
