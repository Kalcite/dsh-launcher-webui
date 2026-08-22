import { Github, LayoutDashboard, Rocket, RefreshCw, Puzzle, Command, Zap } from "lucide-react";
import type { EnvInfo } from "../api";

export type Page = "overview" | "deploy" | "update" | "plugins";

type NavItem = {
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  label: string;
  page?: Page;
  soon?: boolean;
};

const NAV: NavItem[] = [
  { icon: LayoutDashboard, label: "概览", page: "overview" },
  { icon: Rocket, label: "管理 dsh", page: "deploy" },
  { icon: Puzzle, label: "插件管理", page: "plugins" },
  { icon: RefreshCw, label: "更新 dsh", page: "update" },
  { icon: Command, label: "自定义命令", soon: true }
];

export function Sidebar({
  env,
  page,
  onNavigate
}: {
  env: EnvInfo | null;
  page: Page;
  onNavigate: (p: Page) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">
          <Zap size={18} strokeWidth={2.4} />
        </div>
        <div className="logo-text">
          <strong>DSH</strong>
          <span>Launcher</span>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.page === page;
          return (
            <button
              key={item.label}
              className={`nav-item${active ? " active" : ""}${item.soon ? " soon" : ""}`}
              disabled={item.soon}
              title={item.soon ? "即将推出" : item.label}
              onClick={() => item.page && onNavigate(item.page)}
            >
              <Icon size={17} />
              <span>{item.label}</span>
              {item.soon && <em className="soon-tag">soon</em>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="version-bar" title={`dsh-launcher v${env?.launcherVersion ?? "?"}${env?.launcherCommit ? ` · commit ${env.launcherCommit}` : ""}`}>
          <span className="v-name">dsh-launcher</span>
          <code className="v-meta">v{env?.launcherVersion ?? "?"}{env?.launcherCommit ? ` · ${env.launcherCommit}` : ""}</code>
        </div>
        {env && (
          <div className="mini-env">
            <div className="mini-row">
              <span>node</span>
              <code>{env.node}</code>
            </div>
            <div className="mini-row">
              <span>pnpm</span>
              <code>{env.pnpm}</code>
            </div>
            <div className="mini-row">
              <span>git</span>
              <code>{env.git}</code>
            </div>
            <div className="mini-row">
              <span>dsh</span>
              <code title={env.dshRoot}>{env.dshRoot.split(/[\\/]/).slice(-1)[0] || env.dshRoot}</code>
            </div>
          </div>
        )}
        <a
          className="github-link"
          href="https://github.com/deepseek-ai/deepseek-harness"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={14} />
          deepseek-ai/deepseek-harness
        </a>
      </div>
    </aside>
  );
}
