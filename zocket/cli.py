from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from getpass import getpass
from pathlib import Path

from cryptography.fernet import Fernet
from waitress import serve

from .audit import AuditLogger
from .auth import hash_password
from .autostart import install_autostart, remove_autostart, status_autostart
from .backup import create_backup, list_backups, restore_backup
from .config_store import ConfigStore
from .crypto import (
    decrypt_payload,
    delete_key,
    encrypt_payload,
    generate_master_key,
    load_key,
    store_key,
)
from .harden import install_linux_system_services
from .i18n import normalize_lang, tr
from .mcp_server import run_server
from .paths import (
    audit_log_path,
    backups_dir,
    config_path,
    ensure_dirs,
    key_path,
    lock_path,
    vault_path,
)
from .runner import ExecPolicyError, run_with_env, run_with_env_limited
from .vault import ProjectNotFoundError, VaultError, empty_vault, VaultService
from .web import create_web_app


@dataclass
class AppContext:
    vault: VaultService
    cfg_store: ConfigStore
    cfg: dict
    audit: AuditLogger
    lang: str


def t(ctx: AppContext, message_id: str, **kwargs: object) -> str:
    return tr(ctx.lang, message_id, **kwargs)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="zocket",
        description="Local MCP + web secret vault for AI-assisted workflows",
    )
    p.add_argument("--vault-path", help="Path to encrypted vault file")
    p.add_argument("--key-path", help="Path to master key file")
    p.add_argument("--lock-path", help="Path to lock file")
    p.add_argument("--lang", choices=["en", "ru"], help="CLI language")

    sub = p.add_subparsers(dest="action", required=True)

    init_p = sub.add_parser("init", help="Create master key and initialize vault")
    init_p.add_argument("--force", action="store_true", help="Overwrite existing key")
    init_p.add_argument("--autostart", action="store_true")
    init_p.add_argument("--key-storage", choices=["file", "keyring"], default=None)

    mcp_p = sub.add_parser("mcp", help="Run MCP server")
    mcp_p.add_argument(
        "--transport",
        default="stdio",
        choices=["stdio", "sse", "streamable-http"],
    )
    mcp_p.add_argument(
        "--mode",
        default="metadata",
        choices=["metadata", "admin"],
        help="metadata: no secret use/mutation tools; admin: full toolset",
    )
    mcp_p.add_argument("--host", default="127.0.0.1")
    mcp_p.add_argument("--port", type=int, default=18002)

    web_p = sub.add_parser("web", help="Run local web UI")
    web_p.add_argument("--host", default="127.0.0.1")
    web_p.add_argument("--port", type=int, default=18001)
    web_p.add_argument("--threads", type=int, default=8)

    project_p = sub.add_parser("projects", help="Project operations")
    project_sub = project_p.add_subparsers(dest="project_cmd", required=True)
    project_sub.add_parser("list", help="List projects")
    project_create = project_sub.add_parser("create", help="Create project")
    project_create.add_argument("name")
    project_create.add_argument("--description", default="")
    project_create.add_argument("--folder", default="")
    project_folder = project_sub.add_parser(
        "set-folder", help="Set or clear project folder path"
    )
    project_folder.add_argument("name")
    project_folder_group = project_folder.add_mutually_exclusive_group(required=True)
    project_folder_group.add_argument("--folder")
    project_folder_group.add_argument("--clear", action="store_true")
    project_match = project_sub.add_parser(
        "match-path", help="Find project mapped to filesystem path"
    )
    project_match.add_argument("path", nargs="?", default=".")
    project_delete = project_sub.add_parser("delete", help="Delete project")
    project_delete.add_argument("name")

    secret_p = sub.add_parser("secrets", help="Secret operations")
    secret_sub = secret_p.add_subparsers(dest="secret_cmd", required=True)
    secret_list = secret_sub.add_parser("list", help="List secret keys in project")
    secret_list.add_argument("project")
    secret_list.add_argument("--show-values", action="store_true")
    secret_set = secret_sub.add_parser("set", help="Set secret")
    secret_set.add_argument("project")
    secret_set.add_argument("key")
    secret_set.add_argument("value")
    secret_set.add_argument("--description", default="")
    secret_del = secret_sub.add_parser("delete", help="Delete secret")
    secret_del.add_argument("project")
    secret_del.add_argument("key")

    use_p = sub.add_parser("use", help="Run command with project env")
    use_p.add_argument("project")
    use_p.add_argument("--full-output", action="store_true")
    use_p.add_argument("--no-subst", action="store_true")
    use_p.add_argument("exec_command", nargs=argparse.REMAINDER)

    auto_p = sub.add_parser("autostart", help="Manage OS autostart services")
    auto_sub = auto_p.add_subparsers(dest="autostart_cmd", required=True)
    auto_install = auto_sub.add_parser("install", help="Install and enable autostart")
    auto_install.add_argument("--target", choices=["web", "mcp", "both"], default="both")
    auto_install.add_argument("--web-host", default="127.0.0.1")
    auto_install.add_argument("--web-port", type=int, default=18001)
    auto_install.add_argument("--mcp-host", default="127.0.0.1")
    auto_install.add_argument("--mcp-port", type=int, default=18002)
    auto_install.add_argument("--mcp-mode", choices=["metadata", "admin"], default="metadata")
    auto_install.add_argument("--zocket-home", help="ZOCKET_HOME for generated units")
    auto_install.add_argument("--dry-run", action="store_true")
    auto_remove = auto_sub.add_parser("remove", help="Disable and remove autostart")
    auto_remove.add_argument("--target", choices=["web", "mcp", "both"], default="both")
    auto_status = auto_sub.add_parser("status", help="Show autostart status")
    auto_status.add_argument("--target", choices=["web", "mcp", "both"], default="both")

    cfg_p = sub.add_parser("config", help="Config operations")
    cfg_sub = cfg_p.add_subparsers(dest="cfg_cmd", required=True)
    cfg_sub.add_parser("show")
    cfg_lang = cfg_sub.add_parser("set-language")
    cfg_lang.add_argument("language", choices=["en", "ru"])
    cfg_key_storage = cfg_sub.add_parser("set-key-storage")
    cfg_key_storage.add_argument("storage", choices=["file", "keyring"])

    auth_p = sub.add_parser("auth", help="Web auth operations")
    auth_sub = auth_p.add_subparsers(dest="auth_cmd", required=True)
    auth_set = auth_sub.add_parser("set-password")
    auth_set.add_argument("--password")
    auth_sub.add_parser("enable")
    auth_sub.add_parser("disable")

    key_p = sub.add_parser("key", help="Master key operations")
    key_sub = key_p.add_subparsers(dest="key_cmd", required=True)
    key_rotate = key_sub.add_parser("rotate")
    key_rotate.add_argument("--to-storage", choices=["file", "keyring"])

    backup_p = sub.add_parser("backup", help="Backup operations")
    backup_sub = backup_p.add_subparsers(dest="backup_cmd", required=True)
    backup_create = backup_sub.add_parser("create")
    backup_create.add_argument("--output")
    backup_sub.add_parser("list")
    backup_restore = backup_sub.add_parser("restore")
    backup_restore.add_argument("backup_file")

    audit_p = sub.add_parser("audit", help="Audit log operations")
    audit_sub = audit_p.add_subparsers(dest="audit_cmd", required=True)
    audit_tail = audit_sub.add_parser("tail")
    audit_tail.add_argument("--lines", type=int, default=50)
    audit_check = audit_sub.add_parser("check")
    audit_check.add_argument("--minutes", type=int, default=60)
    audit_check.add_argument("--failed-login-threshold", type=int, default=5)

    harden_p = sub.add_parser("harden", help="OS hardening helpers")
    harden_sub = harden_p.add_subparsers(dest="harden_cmd", required=True)
    harden_install = harden_sub.add_parser("install-linux-system")
    harden_install.add_argument("--service-user", default="zocketd")
    harden_install.add_argument("--zocket-home", default="/var/lib/zocket")
    harden_install.add_argument("--web-port", type=int, default=18001)
    harden_install.add_argument("--mcp-host", default="127.0.0.1")
    harden_install.add_argument("--mcp-port", type=int, default=18002)
    harden_install.add_argument("--mcp-mode", choices=["metadata", "admin"], default="metadata")
    harden_install.add_argument("--dry-run", action="store_true")

    return p


def _json(data: object) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _harden_permissions(path: Path, mode: int) -> None:
    if path.exists():
        os.chmod(path, mode)


def build_context(args: argparse.Namespace) -> AppContext:
    ensure_dirs()
    cfg_store = ConfigStore(config_path())
    cfg = cfg_store.ensure_exists()
    lang = normalize_lang(args.lang or str(cfg.get("language", "en")))

    v_path = Path(args.vault_path).expanduser() if args.vault_path else vault_path()
    k_path = Path(args.key_path).expanduser() if args.key_path else key_path()
    l_path = Path(args.lock_path).expanduser() if args.lock_path else lock_path()

    vault = VaultService(
        vault_file=v_path,
        key_file=k_path,
        lock_file=l_path,
        key_storage=str(cfg.get("key_storage", "file")),
        keyring_service=str(cfg.get("keyring_service", "zocket")),
        keyring_account=str(cfg.get("keyring_account", "master-key")),
    )
    audit = AuditLogger(
        path=audit_log_path(),
        enabled=bool(cfg.get("audit_enabled", True)),
    )
    return AppContext(vault=vault, cfg_store=cfg_store, cfg=cfg, audit=audit, lang=lang)


def cmd_init(args: argparse.Namespace, ctx: AppContext) -> int:
    storage = args.key_storage or str(ctx.cfg.get("key_storage", "file"))
    if args.key_storage:
        ctx.cfg["key_storage"] = args.key_storage
        ctx.cfg_store.save(ctx.cfg)
        ctx.vault.key_storage = args.key_storage
    generate_master_key(
        path=ctx.vault.key_file,
        storage=storage,
        keyring_service=str(ctx.cfg.get("keyring_service", "zocket")),
        keyring_account=str(ctx.cfg.get("keyring_account", "master-key")),
        force=args.force,
    )
    ctx.vault._cached_key = None
    ctx.vault.ensure_initialized()
    _harden_permissions(ctx.vault.vault_file, 0o600)
    _harden_permissions(ctx.vault.key_file, 0o600)
    _harden_permissions(ctx.cfg_store.path, 0o600)
    _harden_permissions(ctx.vault.vault_file.parent, 0o700)
    print(t(ctx, "msg.key_file", path=ctx.vault.key_file))
    print(t(ctx, "msg.vault_file", path=ctx.vault.vault_file))
    print(t(ctx, "msg.init_complete"))
    ctx.audit.log("cli.init", "ok", "cli", {"storage": storage})

    if args.autostart:
        result = install_autostart(
            target="both",
            web_host="127.0.0.1",
            web_port=18001,
            mcp_host="127.0.0.1",
            mcp_port=18002,
            mcp_mode="metadata",
            zocket_home=ctx.vault.vault_file.parent,
            dry_run=False,
        )
        _json(result)
    return 0


def cmd_projects(args: argparse.Namespace, ctx: AppContext) -> int:
    ctx.vault.ensure_initialized()
    if args.project_cmd == "list":
        _json(ctx.vault.list_projects())
        ctx.audit.log("cli.projects.list", "ok", "cli")
        return 0
    if args.project_cmd == "create":
        folder_path = args.folder.strip() if args.folder else None
        ctx.vault.create_project(
            args.name,
            description=args.description,
            folder_path=folder_path,
        )
        print(t(ctx, "msg.project_created", name=args.name))
        ctx.audit.log(
            "cli.projects.create",
            "ok",
            "cli",
            {"project": args.name, "folder_path": folder_path},
        )
        return 0
    if args.project_cmd == "set-folder":
        folder_path = None if args.clear else args.folder
        ctx.vault.set_project_folder(args.name, folder_path)
        if args.clear:
            print(t(ctx, "msg.project_folder_cleared", name=args.name))
        else:
            print(t(ctx, "msg.project_folder_set", name=args.name))
        ctx.audit.log(
            "cli.projects.set_folder",
            "ok",
            "cli",
            {"project": args.name, "folder_path": folder_path or ""},
        )
        return 0
    if args.project_cmd == "match-path":
        match = ctx.vault.find_project_by_path(args.path)
        _json(match if match else {})
        ctx.audit.log(
            "cli.projects.match_path",
            "ok",
            "cli",
            {"path": args.path, "matched": bool(match)},
        )
        return 0
    if args.project_cmd == "delete":
        ctx.vault.delete_project(args.name)
        print(t(ctx, "msg.project_deleted", name=args.name))
        ctx.audit.log("cli.projects.delete", "ok", "cli", {"project": args.name})
        return 0
    raise ValueError(f"Unsupported project command: {args.project_cmd}")


def cmd_secrets(args: argparse.Namespace, ctx: AppContext) -> int:
    ctx.vault.ensure_initialized()
    if args.secret_cmd == "list":
        payload = ctx.vault.list_project_secrets(args.project, include_values=bool(args.show_values))
        _json(payload)
        ctx.audit.log("cli.secrets.list", "ok", "cli", {"project": args.project})
        return 0
    if args.secret_cmd == "set":
        ctx.vault.upsert_secret(
            project=args.project,
            key=args.key,
            value=args.value,
            description=args.description,
        )
        print(t(ctx, "msg.secret_saved", key=args.key, project=args.project))
        ctx.audit.log(
            "cli.secrets.set",
            "ok",
            "cli",
            {"project": args.project, "key": args.key},
        )
        return 0
    if args.secret_cmd == "delete":
        ctx.vault.delete_secret(project=args.project, key=args.key)
        print(t(ctx, "msg.secret_deleted", key=args.key, project=args.project))
        ctx.audit.log(
            "cli.secrets.delete",
            "ok",
            "cli",
            {"project": args.project, "key": args.key},
        )
        return 0
    raise ValueError(f"Unsupported secrets command: {args.secret_cmd}")


def cmd_use(args: argparse.Namespace, ctx: AppContext) -> int:
    ctx.vault.ensure_initialized()
    command = list(args.exec_command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        print(t(ctx, "err.usage_use"), file=sys.stderr)
        return 2
    env = ctx.vault.get_project_env(args.project)
    cfg = ctx.cfg_store.load()
    allowlist = cfg.get("exec_allowlist") or []
    return_output = bool(cfg.get("exec_return_output", True))
    allow_full_output = bool(cfg.get("exec_allow_full_output", False))
    substitute_env = bool(cfg.get("exec_substitute_env", True))
    if args.no_subst:
        substitute_env = False
    try:
        max_output = int(cfg.get("exec_max_output_chars", 0))
    except (TypeError, ValueError):
        max_output = 0
    if not return_output:
        max_output = 0
    if args.full_output and not allow_full_output:
        print("Full output is not allowed by policy.", file=sys.stderr)
        return 3
    output_limit = None if args.full_output else max_output
    try:
        result = run_with_env_limited(
            command=command,
            project_env=env,
            allowlist=allowlist,
            max_output_chars=output_limit,
            substitute_env=substitute_env,
        )
    except ExecPolicyError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    ctx.audit.log(
        "cli.use",
        "ok" if result.exit_code == 0 else "failed",
        "cli",
        {"project": args.project, "exit_code": result.exit_code},
    )
    return result.exit_code


def cmd_web(args: argparse.Namespace, ctx: AppContext) -> int:
    ctx.vault.ensure_initialized()
    app = create_web_app(ctx.vault, ctx.cfg_store, ctx.audit)
    serve(app, host=args.host, port=args.port, threads=args.threads)
    return 0


def cmd_mcp(args: argparse.Namespace, ctx: AppContext) -> int:
    ctx.vault.ensure_initialized()
    run_server(
        vault=ctx.vault,
        transport=args.transport,
        mode=args.mode,
        audit=ctx.audit,
        host=args.host,
        port=args.port,
    )
    return 0


def cmd_autostart(args: argparse.Namespace, ctx: AppContext) -> int:
    if args.autostart_cmd == "install":
        z_home = Path(args.zocket_home).expanduser() if args.zocket_home else ctx.vault.vault_file.parent
        result = install_autostart(
            target=args.target,
            web_host=args.web_host,
            web_port=args.web_port,
            mcp_host=args.mcp_host,
            mcp_port=args.mcp_port,
            mcp_mode=args.mcp_mode,
            zocket_home=z_home,
            dry_run=bool(args.dry_run),
        )
    elif args.autostart_cmd == "remove":
        result = remove_autostart(target=args.target)
    elif args.autostart_cmd == "status":
        result = status_autostart(target=args.target)
    else:
        raise ValueError(f"Unsupported autostart command: {args.autostart_cmd}")
    _json(result)
    return 0 if result.get("ok", False) else 1


def cmd_config(args: argparse.Namespace, ctx: AppContext) -> int:
    if args.cfg_cmd == "show":
        _json(ctx.cfg_store.load())
        return 0
    if args.cfg_cmd == "set-language":
        cfg = ctx.cfg_store.load()
        cfg["language"] = args.language
        ctx.cfg_store.save(cfg)
        print(t(ctx, "msg.language_set", lang=args.language))
        ctx.audit.log("cli.config.language", "ok", "cli", {"language": args.language})
        return 0
    if args.cfg_cmd == "set-key-storage":
        cfg = ctx.cfg_store.load()
        cfg["key_storage"] = args.storage
        ctx.cfg_store.save(cfg)
        _json(cfg)
        ctx.audit.log("cli.config.key_storage", "ok", "cli", {"storage": args.storage})
        return 0
    raise ValueError(f"Unsupported config command: {args.cfg_cmd}")


def cmd_auth(args: argparse.Namespace, ctx: AppContext) -> int:
    cfg = ctx.cfg_store.load()
    if args.auth_cmd == "set-password":
        password = args.password
        if not password:
            first = getpass(f"{tr(ctx.lang, 'ui.password')}: ")
            second = getpass(f"{tr(ctx.lang, 'ui.password')} (repeat): ")
            if first != second:
                raise RuntimeError("Passwords do not match")
            password = first
        salt_hex, hash_hex = hash_password(password)
        cfg["web_password_salt"] = salt_hex
        cfg["web_password_hash"] = hash_hex
        cfg["web_auth_enabled"] = True
        ctx.cfg_store.save(cfg)
        print(t(ctx, "msg.password_set"))
        ctx.audit.log("cli.auth.set_password", "ok", "cli")
        return 0
    if args.auth_cmd == "enable":
        cfg["web_auth_enabled"] = True
        ctx.cfg_store.save(cfg)
        _json(cfg)
        ctx.audit.log("cli.auth.enable", "ok", "cli")
        return 0
    if args.auth_cmd == "disable":
        cfg["web_auth_enabled"] = False
        ctx.cfg_store.save(cfg)
        _json(cfg)
        ctx.audit.log("cli.auth.disable", "ok", "cli")
        return 0
    raise ValueError(f"Unsupported auth command: {args.auth_cmd}")


def cmd_key(args: argparse.Namespace, ctx: AppContext) -> int:
    if args.key_cmd != "rotate":
        raise ValueError(f"Unsupported key command: {args.key_cmd}")

    current_cfg = ctx.cfg_store.load()
    current_storage = str(current_cfg.get("key_storage", "file"))
    target_storage = args.to_storage or current_storage
    old_key = load_key(
        ctx.vault.key_file,
        storage=current_storage,
        keyring_service=str(current_cfg.get("keyring_service", "zocket")),
        keyring_account=str(current_cfg.get("keyring_account", "master-key")),
    )
    if ctx.vault.vault_file.exists() and ctx.vault.vault_file.read_bytes():
        payload = decrypt_payload(ctx.vault.vault_file.read_bytes(), old_key)
    else:
        payload = empty_vault()
    new_key = Fernet.generate_key()
    ciphertext = encrypt_payload(payload, new_key)
    ctx.vault.vault_file.write_bytes(ciphertext)
    store_key(
        new_key,
        path=ctx.vault.key_file,
        storage=target_storage,
        keyring_service=str(current_cfg.get("keyring_service", "zocket")),
        keyring_account=str(current_cfg.get("keyring_account", "master-key")),
    )
    if target_storage != current_storage:
        delete_key(
            ctx.vault.key_file,
            storage=current_storage,
            keyring_service=str(current_cfg.get("keyring_service", "zocket")),
            keyring_account=str(current_cfg.get("keyring_account", "master-key")),
        )
    current_cfg["key_storage"] = target_storage
    ctx.cfg_store.save(current_cfg)
    _harden_permissions(ctx.vault.vault_file, 0o600)
    _harden_permissions(ctx.vault.key_file, 0o600)
    ctx.audit.log("cli.key.rotate", "ok", "cli", {"target_storage": target_storage})
    _json({"ok": True, "target_storage": target_storage})
    return 0


def cmd_backup(args: argparse.Namespace, ctx: AppContext) -> int:
    if args.backup_cmd == "create":
        if args.output:
            out = Path(args.output).expanduser()
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(ctx.vault.vault_file.read_bytes())
            target = out
        else:
            target = create_backup(ctx.vault.vault_file, backups_dir())
        _json({"ok": True, "backup_file": str(target)})
        ctx.audit.log("cli.backup.create", "ok", "cli", {"backup_file": str(target)})
        return 0
    if args.backup_cmd == "list":
        rows = [{"path": str(p), "size": p.stat().st_size} for p in list_backups(backups_dir())]
        _json(rows)
        return 0
    if args.backup_cmd == "restore":
        restored = restore_backup(ctx.vault.vault_file, Path(args.backup_file).expanduser())
        _json({"ok": True, "restored_to": str(restored)})
        ctx.audit.log("cli.backup.restore", "ok", "cli", {"backup_file": args.backup_file})
        return 0
    raise ValueError(f"Unsupported backup command: {args.backup_cmd}")


def cmd_audit(args: argparse.Namespace, ctx: AppContext) -> int:
    if args.audit_cmd == "tail":
        _json(ctx.audit.tail(args.lines))
        return 0
    if args.audit_cmd == "check":
        failed = ctx.audit.failed_logins(minutes=args.minutes)
        status = "ok" if failed < args.failed_login_threshold else "alert"
        payload = {
            "status": status,
            "failed_logins_last_window": failed,
            "minutes": args.minutes,
            "threshold": args.failed_login_threshold,
        }
        _json(payload)
        return 0 if status == "ok" else 2
    raise ValueError(f"Unsupported audit command: {args.audit_cmd}")


def cmd_harden(args: argparse.Namespace, ctx: AppContext) -> int:
    if args.harden_cmd == "install-linux-system":
        result = install_linux_system_services(
            service_user=args.service_user,
            zocket_home=Path(args.zocket_home),
            web_port=args.web_port,
            mcp_host=args.mcp_host,
            mcp_port=args.mcp_port,
            mcp_mode=args.mcp_mode,
            dry_run=bool(args.dry_run),
        )
        _json(result)
        return 0 if result.get("ok") else 1
    raise ValueError(f"Unsupported harden command: {args.harden_cmd}")


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    ctx = build_context(args)
    try:
        if args.action == "init":
            return cmd_init(args, ctx)
        if args.action == "projects":
            return cmd_projects(args, ctx)
        if args.action == "secrets":
            return cmd_secrets(args, ctx)
        if args.action == "use":
            return cmd_use(args, ctx)
        if args.action == "web":
            return cmd_web(args, ctx)
        if args.action == "mcp":
            return cmd_mcp(args, ctx)
        if args.action == "autostart":
            return cmd_autostart(args, ctx)
        if args.action == "config":
            return cmd_config(args, ctx)
        if args.action == "auth":
            return cmd_auth(args, ctx)
        if args.action == "key":
            return cmd_key(args, ctx)
        if args.action == "backup":
            return cmd_backup(args, ctx)
        if args.action == "audit":
            return cmd_audit(args, ctx)
        if args.action == "harden":
            return cmd_harden(args, ctx)
    except (
        VaultError,
        ProjectNotFoundError,
        FileNotFoundError,
        PermissionError,
        RuntimeError,
        ValueError,
    ) as exc:
        ctx.audit.log("cli.error", "failed", "cli", {"error": str(exc), "action": args.action})
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
