from pathlib import Path

from zocket.crypto import generate_master_key
from zocket.vault import VaultService


def _vault(tmp_path: Path) -> VaultService:
    v = tmp_path / "vault.enc"
    k = tmp_path / "master.key"
    l = tmp_path / "vault.lock"
    generate_master_key(k, storage="file", force=True)
    svc = VaultService(vault_file=v, key_file=k, lock_file=l)
    svc.ensure_initialized()
    return svc


def test_create_project_with_folder(tmp_path: Path):
    svc = _vault(tmp_path)
    folder = tmp_path / "apps" / "demo"
    folder.mkdir(parents=True)

    svc.create_project("demo", folder_path=str(folder))
    projects = svc.list_projects()

    assert len(projects) == 1
    assert projects[0]["project"] == "demo"
    assert projects[0]["folder_path"] == str(folder.resolve())


def test_find_project_by_path_uses_longest_prefix(tmp_path: Path):
    svc = _vault(tmp_path)
    root = tmp_path / "workspace"
    nested = root / "nested"
    deeper = nested / "service"
    deeper.mkdir(parents=True)

    svc.create_project("root", folder_path=str(root))
    svc.create_project("nested", folder_path=str(nested))

    match = svc.find_project_by_path(str(deeper))
    assert match is not None
    assert match["project"] == "nested"


def test_set_project_folder_can_clear(tmp_path: Path):
    svc = _vault(tmp_path)
    folder = tmp_path / "api"
    folder.mkdir()

    svc.create_project("api")
    svc.set_project_folder("api", str(folder))
    assert svc.list_projects()[0]["folder_path"] == str(folder.resolve())

    svc.set_project_folder("api", None)
    assert svc.list_projects()[0]["folder_path"] is None
