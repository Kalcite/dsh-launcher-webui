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
  DoorOpen,
  ShieldCheck,
  Download,
  PackagePlus,
  Play,
  Square,
  ExternalLink,
  FileText,
  ChevronDown,
  AlertTriangle,
  RotateCcw
} from "lucide-react";
import { api, type DeployStatus, type EnvInfo, type StandbyStatus } from "../api";

type Props = {
  env: EnvInfo | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  deployResult: { ok: boolean; error?: string; target?: string; mode?: string } | null;
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

/** 备用服务器折叠区：手动部署流程与正常部署一致（clone 固定版本 → install → build → build:web），不切换 dshRoot */
function StandbyFold() {
  const [s, setS] = useState<StandbyStatus | null>(null);
  const [lb, setLb] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => api.standbyStatus().then(setS).catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, []);
  const busy = lb || !!s?.busy;
  const deployed = !!s?.deployed;
  const provisioned = !!s?.provisioned;
  const running = !!s?.running;
  const dirState = s?.dir?.state;
  const dirLabel =
    !dirState
      ? "检测中…"
      : dirState === "absent"
        ? "不存在（将全新克隆）"
        : dirState === "empty"
          ? "空目录（将全新克隆）"
          : dirState === "git-repo"
            ? "git 仓库（将同步固定版本）"
            : dirState === "dsh-source"
              ? "含 dsh 源码但非 git —— 部署会拒绝覆盖"
              : "非空残留 —— 部署会提示清理";

  const act = async (a: "bootstrap" | "provision" | "start" | "stop") => {
    setLb(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.standbyAction(a);
      if (!r.ok) setErr(r.error || "操作失败");
      else
        setMsg(
          a === "bootstrap"
            ? "备用端部署已开始（自动检测目录与文件：空目录→全新克隆固定版本；git 仓库→同步固定版本）…"
            : a === "provision"
              ? "初始化用户目录中：router + better-sidebar@0.18 + 运维 skill …"
              : a === "start"
                ? `启动中 → ${s?.webUrl ?? ""}`
                : "停止中…"
        );
      await new Promise((r2) => setTimeout(r2, 900));
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
    setLb(false);
  };

  return (
    <details className="standby-fold" open={false}>
      <summary>
        <ShieldCheck size={15} />
        备用服务器（.dsh_temp）— 固定版本 · 手动部署 · 与正常部署同一流程
        <span className="standby-fold-meta">
          {deployed ? (running ? `运行中 :${s?.port}` : provisioned ? "已就绪 · 未启动" : "已部署 · 未初始化") : "未部署"}
        </span>
        <ChevronDown size={14} className="standby-fold-caret" />
      </summary>
      <div className="standby-fold-body">
        <p className="hint">
          <AlertTriangle size={12} />
          备用 dsh <strong>不随启动器更新、不提交仓库</strong>（.dsh_temp 整体 gitignore）。部署按钮会
          <strong>自动检测</strong>备用本体目录（默认 <code>.dsh_temp/dsh</code>）与关键文件：
          空/缺失 → 全新克隆固定版本；已是 git 仓库 → 同步固定版本并重建；非空非 git → 提示清理。构建流程与上方
          「一键部署 dsh」一致（clone/同步 → pnpm install → 全量 build → build:web），仅版本固定为{" "}
          <code>{s?.tag ?? "dsh-v0.1.3-alpha.1"}</code>（commit d347e70）且<strong>不切换 dshRoot</strong>；
          随后「初始化用户目录」装入 router（注入器+预设）+ better-sidebar@0.18 + 运维 skill。
        </p>
        <div className="deploy-status">
          <Row icon={<FolderTree size={13} />} label="备用本体 (standbyRoot)" value={s?.root ?? "…"} />
          <Row icon={<Boxes size={13} />} label="独立用户目录 (standbyHome)" value={s?.home ?? "…"} />
          <Row icon={<GitCommit size={13} />} label="固定版本" value={s?.tag ?? "…"} />
          <Row icon={<GitBranch size={13} />} label="端口 / profile" value={s ? `${s.port} / ${s.profile}` : "…"} />
          <Row icon={<Hammer size={13} />} label="本体构建 (dist)" value={deployed ? (s?.distOk ? "已构建" : "未构建") : "—"} ok={deployed ? s?.distOk : undefined} />
          <Row icon={<PackagePlus size={13} />} label="用户目录初始化" value={provisioned ? "已完成（router + sidebar + skill）" : "未初始化"} ok={provisioned} />
          <Row icon={<FolderTree size={13} />} label="目录检测" value={dirLabel} />
          <Row
            icon={<CheckCircle2 size={13} />}
            label="运行状态"
            value={running ? `运行中 · HTTP ${s?.httpCode ?? "OK"}` : deployed ? "已停止" : "未部署"}
            ok={running ? s?.httpOk : undefined}
          />
        </div>
        <div className="btn-row">
          {!deployed ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => act("bootstrap")} title="自动检测 .dsh_temp/dsh 及关键文件：空/缺失→全新克隆固定版本；git 仓库→同步固定版本">
              <Download size={15} /> 部署备用端（自动检测目录）
            </button>
          ) : !provisioned ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => act("provision")}>
              <PackagePlus size={15} /> 初始化用户目录
            </button>
          ) : !running ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => act("start")}>
              <Play size={15} /> 启动备用端
            </button>
          ) : (
            <button className="btn btn-danger" disabled={busy} onClick={() => act("stop")}>
              <Square size={14} /> 停止备用端
            </button>
          )}
          {deployed && !running && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => act("bootstrap")} title="重新同步固定版本（自动检测 git 目录后 fetch tag + 重建）">
              <RotateCcw size={14} /> 重新部署/同步
            </button>
          )}
        </div>
        <div className="btn-row quick">
          <button className="btn btn-ghost btn-sm" disabled={!deployed} onClick={() => api.open("standbyWeb")}>
            <ExternalLink size={14} /> 打开备用 UI
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!deployed} onClick={() => api.open("standbyFolder")}>
            <FolderOpen size={14} /> 备用本体目录
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!deployed} onClick={() => api.open("standbyLogs")}>
            <FileText size={14} /> 备用日志
          </button>
        </div>
        {msg && <div className="notice-line">{msg}</div>}
        {err && <div className="error-line">{err}</div>}
      </div>
    </details>
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
        setNotice(
          deployResult.mode === "standby"
            ? "备用端部署已启动/完成（固定版本，未切换 dshRoot；进度见日志面板）"
            : `部署完成！dshRoot 已切换 → ${deployResult.target}`
        );
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
        <button
          className="btn btn-primary"
          disabled={busy || !dir.trim()}
          onClick={doDeploy}
          title="克隆仓库 + 安装依赖 + 构建，完成后切换 dshRoot"
        >
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

      <StandbyFold />
    </section>
  );
}
