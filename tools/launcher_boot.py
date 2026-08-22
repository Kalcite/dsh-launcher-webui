#!/usr/bin/env python3
"""dsh-launcher 启动引导（Python 承载全部启动逻辑，.cmd 仅负责调用）。

用法（由 launcher.cmd / launcher-stop.cmd 调用）:
  launcher_boot.py [--port N] [--web-port N] [--profile name] [--open]
      启动后端：更新收尾 → 已运行检测 → node 选择 → 启动 server/index.mjs
  launcher_boot.py --stop [--port N]
      停止后端（按 launcher 端口找 PID 并 taskkill 进程树）
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

KIT_ROOT = Path(__file__).resolve().parent.parent
SERVER = KIT_ROOT / "server" / "index.mjs"
DIST_HTML = KIT_ROOT / "dist" / "index.html"
MARK = KIT_ROOT / ".update-pending"
CONFIG = KIT_ROOT / "config.json"
NODE_CANDIDATES = [
    KIT_ROOT / ".runtime" / "node" / "node.exe",                              # 套件便携 Node
    KIT_ROOT.parent / "deepseek_harness" / ".runtime" / "node" / "node.exe",  # dsh 部署便携 Node
]


def configure_console():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def log(msg):
    print(f"[dsh-launcher] {msg}")


def read_config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except Exception:
        return {}


def resolve_node():
    for c in NODE_CANDIDATES:
        if c.exists():
            return str(c)
    return shutil.which("node")


def port_pids(port):
    """返回监听该端口的 PID 列表（Windows netstat）。"""
    try:
        out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return []
    pids = set()
    for line in out.splitlines():
        if f":{port} " in line and "LISTENING" in line.upper():
            parts = line.split()
            if parts and parts[-1].isdigit() and parts[-1] != "0":
                pids.add(int(parts[-1]))
    return sorted(pids)


def open_browser(url):
    try:
        subprocess.Popen(["cmd", "/c", "start", "", url], shell=False)
    except Exception:
        pass


def kill_tree(pid):
    try:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True, timeout=10)
    except Exception:
        pass


def finish_pending():
    """存在 .update-pending 标记 → pnpm install 收尾 → 删除标记。"""
    if not MARK.exists():
        return
    log("检测到待完成的更新，执行收尾 (pnpm install)…")
    env = dict(os.environ)
    env["CI"] = "true"
    pnpm = KIT_ROOT / ".runtime" / "node" / "pnpm.cmd"
    try:
        if pnpm.exists():
            subprocess.run(f'"{pnpm}" install', cwd=str(KIT_ROOT), shell=True, env=env)
        else:
            subprocess.run("pnpm install", cwd=str(KIT_ROOT), shell=True, env=env)
    except Exception as e:
        log(f"收尾失败: {e}")
    try:
        MARK.unlink()
        log("更新收尾完成，标记已清除")
    except Exception:
        pass


def boot(args):
    cfg = read_config()
    launcher_port = args.port or int(cfg.get("launcherPort", 5177))
    web_port = args.web_port or int(cfg.get("webPort", 3080))
    profile = args.profile or cfg.get("profile") or "web"

    # 1) 更新收尾
    finish_pending()

    # 2) 前端产物检查
    if not DIST_HTML.exists():
        log("前端未构建，请先运行 setup.cmd")
        return 1

    # 3) 已运行检测：launcher 端口有监听 → 只打开浏览器
    if port_pids(launcher_port):
        log(f"启动器已在运行 (端口 {launcher_port})，仅打开界面…")
        open_browser(f"http://127.0.0.1:{launcher_port}")
        return 0

    # 4) node 选择
    node = resolve_node()
    if not node:
        log("未找到 node，请先运行 setup.cmd 安装便携 Node")
        return 1

    # 5) 启动后端（前台，Ctrl+C 停止）
    cmd = [node, str(SERVER), "--open", "--port", str(launcher_port)]
    if args.web_port:
        cmd += ["--web-port", str(args.web_port)]
    if args.profile:
        cmd += ["--profile", args.profile]
    log(f"使用 node: {node}")
    log(f"启动后端 → http://127.0.0.1:{launcher_port}（dsh 端口 {web_port}，profile {profile}）")
    log("Ctrl+C 停止")
    try:
        proc = subprocess.run(cmd, cwd=str(KIT_ROOT))
        return proc.returncode
    except KeyboardInterrupt:
        log("已停止")
        return 0


def stop(args):
    cfg = read_config()
    launcher_port = args.port or int(cfg.get("launcherPort", 5177))
    pids = port_pids(launcher_port)
    if not pids:
        log(f"端口 {launcher_port} 无监听（启动器未运行）")
        return 0
    for pid in pids:
        log(f"停止后端 PID {pid}…")
        kill_tree(pid)
    log(f"端口 {launcher_port} 已释放")
    return 0


def main():
    configure_console()
    ap = argparse.ArgumentParser(description="dsh-launcher 启动引导", add_help=False)
    ap.add_argument("--port", type=int)
    ap.add_argument("--web-port", type=int)
    ap.add_argument("--profile")
    ap.add_argument("--open", action="store_true")
    ap.add_argument("--stop", action="store_true")
    args, _ = ap.parse_known_args()
    if args.stop:
        sys.exit(stop(args))
    sys.exit(boot(args))


if __name__ == "__main__":
    main()
