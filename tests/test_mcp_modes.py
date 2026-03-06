from pathlib import Path

from zocket.crypto import generate_master_key
from zocket.mcp_server import create_server
from zocket.vault import VaultService


def _vault(tmp_path: Path) -> VaultService:
    v = tmp_path / "vault.enc"
    k = tmp_path / "master.key"
    l = tmp_path / "vault.lock"
    generate_master_key(k, storage="file", force=True)
    svc = VaultService(vault_file=v, key_file=k, lock_file=l)
    svc.ensure_initialized()
    svc.upsert_secret("demo", "SSH_HOST", "1.2.3.4")
    return svc


def test_metadata_mode_tools(tmp_path: Path):
    server = create_server(_vault(tmp_path), mode="metadata")
    tools = sorted(server._tool_manager._tools.keys())
    assert tools == ["find_project_by_path", "list_project_keys", "list_projects", "ping"]


def test_admin_mode_has_mutation_tools(tmp_path: Path):
    server = create_server(_vault(tmp_path), mode="admin")
    tools = sorted(server._tool_manager._tools.keys())
    assert "upsert_secret" in tools
    assert "run_with_project_env" in tools
    assert "find_project_by_path" in tools
