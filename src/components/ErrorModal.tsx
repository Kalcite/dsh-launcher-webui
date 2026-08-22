import { AlertTriangle, FolderOpen, Undo2, X } from "lucide-react";
import { api, type FatalInfo } from "../api";

type Props = {
  fatal: FatalInfo | null;
  busy: boolean;
  onRecover: (kind: "update" | "plugin") => void;
  onClose: () => void;
};

export function ErrorModal({ fatal, busy, onRecover, onClose }: Props) {
  if (!fatal) return null;
  const recoverable = fatal.recoverable && (fatal.kind === "update" || fatal.kind === "plugin");

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-head">
          <span className="modal-icon"><AlertTriangle size={20} /></span>
          <h2>发生致命错误</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy} title="关闭">
            <X size={14} />
          </button>
        </div>
        <p className="modal-msg">{fatal.message}</p>
        <p className="modal-hint">
          错误进程已被终止。可选择查看日志定位原因，或尝试恢复到操作前的状态。
          {fatal.kind === "update" && "（恢复 = 回退 dsh 到更新前版本并校验构建/环境）"}
          {fatal.kind === "plugin" && "（恢复 = 清除插件安装内容并还原配置文件）"}
        </p>
        <div className="btn-row modal-actions">
          <button className="btn btn-ghost" onClick={() => api.open("logs")} title="打开服务端日志目录 (.dshctl)">
            <FolderOpen size={15} /> 查看日志
          </button>
          {recoverable && (
            <button className="btn btn-primary" disabled={busy} onClick={() => onRecover(fatal.kind as "update" | "plugin")}>
              <Undo2 size={15} /> 尝试恢复
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            稍后处理
          </button>
        </div>
      </div>
    </div>
  );
}
