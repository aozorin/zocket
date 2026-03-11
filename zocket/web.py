from __future__ import annotations

import os
import secrets
from functools import wraps
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

from .audit import AuditLogger
from .auth import hash_password, verify_password
from .config_store import ConfigStore
from .i18n import normalize_lang, tr
from .vault import ProjectNotFoundError, SecretNotFoundError, ValidationError, VaultService

DEFAULT_FOLDER_PICKER_ROOTS = (
    "/home",
    "/srv",
    "/opt",
    "/var/www",
    "/var/lib",
)

THEME_STANDARD = "standard"
THEME_ZORIN = "zorin"
AVAILABLE_THEMES = {THEME_STANDARD, THEME_ZORIN}


def _folder_picker_roots(config: dict) -> list[Path]:
    raw = config.get("folder_picker_roots")
    candidates = raw if isinstance(raw, list) and raw else list(DEFAULT_FOLDER_PICKER_ROOTS)
    roots: list[Path] = []
    seen: set[str] = set()
    for item in candidates:
        if not isinstance(item, str) or not item.strip():
            continue
        try:
            resolved = Path(item).expanduser().resolve(strict=False)
        except OSError:
            continue
        as_str = str(resolved)
        if as_str in seen:
            continue
        if resolved.exists() and resolved.is_dir():
            roots.append(resolved)
            seen.add(as_str)
    return roots


def _is_subpath(child: Path, parent: Path) -> bool:
    return child == parent or child.is_relative_to(parent)


def _is_allowed_path(path: Path, roots: list[Path]) -> bool:
    return any(_is_subpath(path, root) for root in roots)


def _safe_resolve(path: str) -> Path:
    return Path(path).expanduser().resolve(strict=False)


def _current_lang(config: dict) -> str:
    if "lang" in request.args:
        lang = normalize_lang(request.args.get("lang"))
        session["lang"] = lang
        return lang
    if "lang" in session:
        return normalize_lang(str(session.get("lang")))
    return normalize_lang(str(config.get("language", "en")))


def normalize_variant(value: str | None) -> str:
    if not value:
        return "dark"
    normalized = value.strip().lower()
    return normalized if normalized in {"light", "dark"} else "dark"


def _current_variant(config: dict[str, Any]) -> str:
    if "variant" in request.args:
        variant = normalize_variant(request.args.get("variant"))
        session["theme_variant"] = variant
        return variant
    stored = session.get("theme_variant")
    if stored:
        return normalize_variant(str(stored))
    return normalize_variant(str(config.get("theme_variant", "dark")))


def normalize_theme(value: str | None) -> str:
    if not value:
        return THEME_STANDARD
    normalized = value.strip().lower()
    return normalized if normalized in AVAILABLE_THEMES else THEME_STANDARD


def _current_theme(config: dict[str, Any]) -> str:
    arg_theme = request.args.get("theme")
    if arg_theme:
        theme = normalize_theme(arg_theme)
        session["theme"] = theme
        return theme
    stored = session.get("theme")
    if stored:
        return normalize_theme(str(stored))
    return normalize_theme(str(config.get("theme", THEME_STANDARD)))


def _is_authenticated(config: dict) -> bool:
    if not bool(config.get("web_auth_enabled", True)):
        return True
    return bool(session.get("is_authenticated", False))


def _has_password(config: dict) -> bool:
    return bool(config.get("web_password_hash")) and bool(config.get("web_password_salt"))


def create_web_app(
    vault: VaultService,
    cfg_store: ConfigStore,
    audit: AuditLogger,
) -> Flask:
    template_dir = Path(__file__).with_name("templates").resolve()
    app = Flask(__name__, template_folder=str(template_dir))
    cfg = cfg_store.ensure_exists()

    app.config["SECRET_KEY"] = cfg["session_secret"]
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = False

    @app.context_processor
    def inject_i18n():
        cfg_local = cfg_store.load()
        lang = _current_lang(cfg_local)
        theme = _current_theme(cfg_local)
        variant = _current_variant(cfg_local)
        return {
            "t": lambda key, **kwargs: tr(lang, key, **kwargs),
            "lang": lang,
            "theme": theme,
            "theme_variant": variant,
        }

    def login_required(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            cfg_local = cfg_store.load()
            _current_lang(cfg_local)
            if _is_authenticated(cfg_local):
                return fn(*args, **kwargs)
            return redirect(url_for("login", next=request.path))

        return wrapper

    @app.get("/login")
    def login():
        cfg_local = cfg_store.load()
        if not bool(cfg_local.get("web_auth_enabled", True)):
            return redirect("/")
        if session.get("is_authenticated"):
            return redirect("/")
        lang = _current_lang(cfg_local)
        error = request.args.get("error")
        next_path = request.args.get("next") or request.path
        theme = _current_theme(cfg_local)
        return render_template(
            "login.html",
            error=error,
            lang=lang,
            missing_password=not _has_password(cfg_local),
            next_path=next_path,
            theme=theme,
        )

    @app.post("/login")
    def login_post():
        cfg_local = cfg_store.load()
        if not bool(cfg_local.get("web_auth_enabled", True)):
            return redirect("/")
        lang = _current_lang(cfg_local)
        if not _has_password(cfg_local):
            return redirect("/login")
        password = request.form.get("password", "")
        ok = verify_password(
            password=password,
            salt_hex=str(cfg_local["web_password_salt"]),
            expected_hash_hex=str(cfg_local["web_password_hash"]),
            iterations=int(cfg_local.get("web_password_iterations", 390000)),
        )
        if not ok:
            audit.log("web.login", "failed", "web", {"remote_addr": request.remote_addr})
            return redirect(f"/login?error={quote_plus(tr(lang, 'ui.invalid_login'))}")
        session["is_authenticated"] = True
        audit.log("web.login", "ok", "web", {"remote_addr": request.remote_addr})
        return redirect("/")

    @app.post("/setup/first-run")
    def first_run_setup():
        cfg_local = cfg_store.load()
        lang = _current_lang(cfg_local)
        if _has_password(cfg_local):
            return redirect("/login")

        mode = (request.form.get("mode") or "").strip()
        if mode == "set_password":
            password = request.form.get("password", "")
            password_repeat = request.form.get("password_repeat", "")
            if not password:
                return redirect(f"/login?error={quote_plus(tr(lang, 'ui.password_required'))}")
            if password != password_repeat:
                return redirect(f"/login?error={quote_plus(tr(lang, 'ui.passwords_do_not_match'))}")
            salt_hex, hash_hex = hash_password(password)
            cfg_local["web_password_salt"] = salt_hex
            cfg_local["web_password_hash"] = hash_hex
            cfg_local["web_auth_enabled"] = True
            cfg_store.save(cfg_local)
            session["is_authenticated"] = True
            audit.log("web.setup.first_run", "ok", "web", {"mode": "set_password"})
            return redirect("/")

        if mode == "generate_password":
            generated = secrets.token_urlsafe(24)
            salt_hex, hash_hex = hash_password(generated)
            cfg_local["web_password_salt"] = salt_hex
            cfg_local["web_password_hash"] = hash_hex
            cfg_local["web_auth_enabled"] = True
            cfg_store.save(cfg_local)
            session["is_authenticated"] = True
            session["generated_password_once"] = generated
            audit.log("web.setup.first_run", "ok", "web", {"mode": "generate_password"})
            return redirect("/")

        if mode == "no_password":
            confirmed = request.form.get("confirm_no_password") == "1"
            if not confirmed:
                return redirect(
                    f"/login?error={quote_plus(tr(lang, 'ui.confirm_insecure_required'))}"
                )
            cfg_local["web_auth_enabled"] = False
            cfg_local["web_password_salt"] = ""
            cfg_local["web_password_hash"] = ""
            cfg_store.save(cfg_local)
            session["is_authenticated"] = True
            audit.log("web.setup.first_run", "ok", "web", {"mode": "no_password"})
            return redirect("/")

        return redirect(f"/login?error={quote_plus(tr(lang, 'ui.invalid_setup_option'))}")

    @app.post("/set-theme")
    def set_theme():
        theme = normalize_theme(request.form.get("theme"))
        session["theme"] = theme
        next_url = request.form.get("next") or request.referrer or "/"
        return redirect(next_url)

    @app.post("/set-theme-variant")
    def set_theme_variant():
        variant = normalize_variant(request.form.get("variant"))
        session["theme_variant"] = variant
        next_url = request.form.get("next") or request.referrer or "/"
        return redirect(next_url)

    @app.post("/logout")
    def logout():
        session.pop("is_authenticated", None)
        return redirect("/login")

    @app.get("/api/folders")
    @login_required
    def list_folders():
        cfg_local = cfg_store.load()
        roots = _folder_picker_roots(cfg_local)
        if not roots:
            return jsonify({"ok": False, "error": "Folder picker is not configured."}), 500

        requested = (request.args.get("path") or "").strip()
        if not requested:
            root_rows = [{"name": str(path), "path": str(path)} for path in roots]
            return jsonify(
                {
                    "ok": True,
                    "current": None,
                    "parent": None,
                    "roots": root_rows,
                    "directories": root_rows,
                }
            )

        try:
            current = _safe_resolve(requested)
        except OSError:
            return jsonify({"ok": False, "error": "Invalid folder path."}), 400

        if not _is_allowed_path(current, roots):
            return jsonify({"ok": False, "error": "Folder is outside allowed roots."}), 403
        if not current.exists():
            return jsonify({"ok": False, "error": "Folder does not exist."}), 404
        if not current.is_dir():
            return jsonify({"ok": False, "error": "Path is not a folder."}), 400

        directories: list[dict[str, str]] = []
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    if entry.is_dir(follow_symlinks=False):
                        if entry.name.startswith("."):
                            continue
                        try:
                            child = _safe_resolve(entry.path)
                        except OSError:
                            continue
                        if _is_allowed_path(child, roots):
                            directories.append({"name": entry.name, "path": str(child)})
        except PermissionError:
            return jsonify({"ok": False, "error": "Permission denied for this folder."}), 403
        directories.sort(key=lambda row: row["name"].lower())

        parent = current.parent
        parent_path = str(parent) if _is_allowed_path(parent, roots) and parent != current else None
        return jsonify(
            {
                "ok": True,
                "current": str(current),
                "parent": parent_path,
                "roots": [{"name": str(path), "path": str(path)} for path in roots],
                "directories": directories,
            }
        )

    @app.get("/")
    @login_required
    def index():
        cfg_local = cfg_store.load()
        project = request.args.get("project")
        show_values = bool(int(request.args.get("show_values", "0")))
        error = request.args.get("error")
        lang = _current_lang(cfg_local)
        generated_password = session.pop("generated_password_once", None)

        projects = vault.list_projects()
        selected_project = project or (projects[0]["project"] if projects else None)
        selected_project_info = next(
            (item for item in projects if item["project"] == selected_project),
            None,
        )
        secrets = (
            vault.list_project_secrets(
                selected_project, include_values=show_values
            )
            if selected_project
            else []
        )
        return render_template(
            "index.html",
            projects=projects,
            selected_project=selected_project,
            selected_project_info=selected_project_info,
            secrets=secrets,
            show_values=show_values,
            error=error,
            lang=lang,
            generated_password=generated_password,
        )

    @app.post("/projects/create")
    @login_required
    def create_project():
        name = request.form.get("name", "")
        description = request.form.get("description", "")
        folder_path = request.form.get("folder_path", "")
        try:
            vault.create_project(
                name,
                description=description,
                folder_path=folder_path,
            )
            audit.log(
                "web.project.create",
                "ok",
                "web",
                {"project": name, "folder_path": folder_path},
            )
        except ValidationError as exc:
            audit.log("web.project.create", "failed", "web", {"error": str(exc)})
            return redirect(f"/?error={quote_plus(str(exc))}")
        return redirect(f"/?project={name}")

    @app.post("/projects/<project>/folder")
    @login_required
    def set_project_folder(project: str):
        clear = request.form.get("clear") == "1"
        folder_path = None if clear else request.form.get("folder_path", "")
        try:
            vault.set_project_folder(project, folder_path)
            audit.log(
                "web.project.set_folder",
                "ok",
                "web",
                {"project": project, "cleared": clear},
            )
        except (ValidationError, ProjectNotFoundError) as exc:
            audit.log(
                "web.project.set_folder",
                "failed",
                "web",
                {"project": project, "error": str(exc)},
            )
            return redirect(f"/?project={project}&error={quote_plus(str(exc))}")
        return redirect(f"/?project={project}")

    @app.post("/projects/<project>/secrets/upsert")
    @login_required
    def upsert_secret(project: str):
        key = request.form.get("key", "")
        value = request.form.get("value", "")
        description = request.form.get("description", "")
        try:
            vault.upsert_secret(project=project, key=key, value=value, description=description)
            audit.log("web.secret.upsert", "ok", "web", {"project": project, "key": key})
        except (ValidationError, ProjectNotFoundError) as exc:
            audit.log(
                "web.secret.upsert",
                "failed",
                "web",
                {"project": project, "key": key, "error": str(exc)},
            )
            return redirect(f"/?project={project}&error={quote_plus(str(exc))}")
        return redirect(f"/?project={project}")

    @app.post("/projects/<project>/secrets/<key>/delete")
    @login_required
    def delete_secret(project: str, key: str):
        try:
            vault.delete_secret(project=project, key=key)
            audit.log("web.secret.delete", "ok", "web", {"project": project, "key": key})
        except (ProjectNotFoundError, SecretNotFoundError) as exc:
            audit.log(
                "web.secret.delete",
                "failed",
                "web",
                {"project": project, "key": key, "error": str(exc)},
            )
            return redirect(f"/?project={project}&error={quote_plus(str(exc))}")
        return redirect(f"/?project={project}")

    @app.get("/projects/<project>/secrets/<key>/value")
    @login_required
    def secret_value(project: str, key: str):
        try:
            secret = vault.get_secret(project=project, key=key)
            audit.log(
                "web.secret.view",
                "ok",
                "web",
                {"project": project, "key": key},
            )
            return jsonify(
                {
                    "ok": True,
                    "key": key,
                    "value": secret.get("value", ""),
                    "description": secret.get("description", ""),
                    "updated_at": secret.get("updated_at"),
                }
            )
        except (ProjectNotFoundError, SecretNotFoundError) as exc:
            audit.log(
                "web.secret.view",
                "failed",
                "web",
                {"project": project, "key": key, "error": str(exc)},
            )
            return jsonify({"ok": False, "error": str(exc)}), 404

    @app.post("/projects/<project>/delete")
    @login_required
    def delete_project(project: str):
        try:
            vault.delete_project(project=project)
            audit.log("web.project.delete", "ok", "web", {"project": project})
        except ProjectNotFoundError as exc:
            audit.log("web.project.delete", "failed", "web", {"error": str(exc)})
            return redirect(f"/?error={quote_plus(str(exc))}")
        return redirect("/")

    return app
