from pathlib import Path

from zocket.audit import AuditLogger
from zocket.config_store import ConfigStore
from zocket.crypto import generate_master_key
from zocket.vault import VaultService
from zocket.web import create_web_app


def _app(tmp_path: Path):
    vault_file = tmp_path / "vault.enc"
    key_file = tmp_path / "master.key"
    lock_file = tmp_path / "vault.lock"
    cfg_file = tmp_path / "config.json"
    audit_file = tmp_path / "audit.log"

    generate_master_key(key_file, storage="file", force=True)
    vault = VaultService(vault_file=vault_file, key_file=key_file, lock_file=lock_file)
    vault.ensure_initialized()
    cfg_store = ConfigStore(cfg_file)
    cfg_store.ensure_exists()
    audit = AuditLogger(audit_file)
    app = create_web_app(vault=vault, cfg_store=cfg_store, audit=audit)
    app.config["TESTING"] = True
    return app, cfg_store


def test_first_run_set_password(tmp_path: Path):
    app, cfg_store = _app(tmp_path)
    client = app.test_client()

    response = client.post(
        "/setup/first-run",
        data={
            "mode": "set_password",
            "password": "StrongPass123!",
            "password_repeat": "StrongPass123!",
        },
        follow_redirects=False,
    )
    assert response.status_code == 302
    cfg = cfg_store.load()
    assert cfg["web_auth_enabled"] is True
    assert len(cfg["web_password_hash"]) > 0
    assert len(cfg["web_password_salt"]) > 0


def test_first_run_no_password_requires_confirmation(tmp_path: Path):
    app, cfg_store = _app(tmp_path)
    client = app.test_client()

    response = client.post(
        "/setup/first-run",
        data={"mode": "no_password"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    cfg = cfg_store.load()
    assert cfg["web_auth_enabled"] is True
    assert cfg["web_password_hash"] == ""


def test_first_run_no_password_with_confirmation(tmp_path: Path):
    app, cfg_store = _app(tmp_path)
    client = app.test_client()

    response = client.post(
        "/setup/first-run",
        data={"mode": "no_password", "confirm_no_password": "1"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    cfg = cfg_store.load()
    assert cfg["web_auth_enabled"] is False
    assert cfg["web_password_hash"] == ""
