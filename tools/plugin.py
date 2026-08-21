#!/usr/bin/env python3
"""dsh-launcher plugin manager (Python) - part of the portable kit.

Usage:
  plugin.py list [--profile web]
  plugin.py install <package> [--profile web] [--dsh-root <dir>]
  plugin.py remove <package> [--profile web] [--dsh-root <dir>]
  plugin.py disable <bundle> [--profile web]
  plugin.py enable  <bundle> [--profile web]

Bundles come from the profile manifest (dsh.profile.bundles); disable/enable
patch the profile's cordis.patch.yml (user layer) with pyyaml, the same
mechanism the super-injector tooling uses.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

KIT_ROOT = Path(__file__).resolve().parent.parent
NODE_EXE = KIT_ROOT / ".runtime" / "node" / "node.exe"
CONFIG = KIT_ROOT / "config.json"


def configure_console():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def dsh_home() -> Path:
    """解析 DSH_HOME：config.json 的 dshHome（相对 dshRoot）> 环境变量 > ~/.dsh。"""
    cfg = read_json(CONFIG)
    root = cfg.get("dshRoot") or "../deepseek_harness"
    root_path = Path(root)
    if not root_path.is_absolute():
        root_path = KIT_ROOT / root_path
    home = cfg.get("dshHome")
    if home:
        p = Path(os.path.expanduser(home))
        if p.is_absolute():
            return p
        return (root_path / p).resolve()
    env_home = os.environ.get("DSH_HOME")
    if env_home and env_home.strip():
        return Path(os.path.expanduser(env_home)).resolve()
    return Path.home() / ".dsh"


def profile_dir(profile: str) -> Path:
    return dsh_home() / "profiles" / profile


def read_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def default_dsh_root() -> str:
    cfg = read_json(CONFIG)
    root = cfg.get("dshRoot") or "../deepseek_harness"
    p = Path(root)
    return str(p if p.is_absolute() else KIT_ROOT / p)


def run_dsh(dsh_root: str, args):
    """通过套件便携 Node 运行 dsh CLI 的 plugin 子命令。"""
    bin_ts = Path(dsh_root) / "apps" / "cli" / "src" / "bin.ts"
    node = str(NODE_EXE) if NODE_EXE.exists() else "node"
    cmd = [node, "--import", "tsx/esm", str(bin_ts)] + args
    return subprocess.run(cmd, cwd=dsh_root, shell=False)


def bundles_of(manifest) -> list:
    try:
        return list(((manifest.get("dsh") or {}).get("profile") or {}).get("bundles") or [])
    except Exception:
        return []


def cmd_list(profile: str):
    pdir = profile_dir(profile)
    manifest = read_json(pdir / "package.json")
    bundles = bundles_of(manifest)
    patch = pdir / "cordis.patch.yml"
    disabled = set()
    if patch.exists():
        try:
            import yaml
            data = yaml.safe_load(patch.read_text(encoding="utf-8")) or []
            for entry in data if isinstance(data, list) else []:
                if isinstance(entry, dict) and entry.get("disabled") and entry.get("id"):
                    disabled.add(entry["id"])
        except Exception as e:
            print(f"  (warning: patch read failed: {e})")
    print(f"Profile: {profile}  @ {pdir}")
    print(f"Bundles ({len(bundles)}):")
    if not bundles:
        print("  (none)")
    for b in bundles:
        tag = " [disabled]" if b in disabled else ""
        print(f"  - {b}{tag}")


def cmd_patch(profile: str, bundle: str, disable: bool):
    import yaml
    pdir = profile_dir(profile)
    pdir.mkdir(parents=True, exist_ok=True)
    patch = pdir / "cordis.patch.yml"
    data = []
    if patch.exists():
        try:
            data = yaml.safe_load(patch.read_text(encoding="utf-8")) or []
        except Exception as e:
            sys.exit(f"[plugin] 无法解析 {patch}: {e}")
    if not isinstance(data, list):
        data = []
    entries = [e for e in data if isinstance(e, dict)]
    found = next((e for e in entries if e.get("id") == bundle), None)
    if disable:
        if found is None:
            entries.append({"id": bundle, "disabled": True})
        else:
            found["disabled"] = True
    else:
        if found is not None:
            keys = set(found.keys())
            if keys <= {"id", "disabled"}:
                entries.remove(found)
            else:
                found.pop("disabled", None)
    with patch.open("w", encoding="utf-8") as f:
        yaml.safe_dump(entries, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
    print(f"[plugin] {'禁用' if disable else '启用'} {bundle} -> {patch} (restart dsh to apply)")


def main():
    configure_console()
    ap = argparse.ArgumentParser(description="dsh-launcher plugin manager")
    ap.add_argument("command", choices=["list", "install", "remove", "disable", "enable"])
    ap.add_argument("target", nargs="?")
    ap.add_argument("--profile", default="web")
    ap.add_argument("--dsh-root", default=None)
    args = ap.parse_args()

    if args.command in ("install", "remove"):
        if not args.target:
            sys.exit("[plugin] missing package name")
        root = args.dsh_root or default_dsh_root()
        r = run_dsh(root, ["plugin", "--profile", args.profile, args.command, args.target])
        sys.exit(r.returncode)
    elif args.command == "list":
        cmd_list(args.profile)
    elif args.command in ("disable", "enable"):
        if not args.target:
            sys.exit("[plugin] missing bundle name")
        cmd_patch(args.profile, args.target, disable=(args.command == "disable"))


if __name__ == "__main__":
    main()
