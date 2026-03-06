from pathlib import Path

from zocket.backup import create_backup, restore_backup


def test_backup_create_restore(tmp_path: Path):
    vault = tmp_path / "vault.enc"
    vault.write_bytes(b"one")
    backups = tmp_path / "backups"
    backup_file = create_backup(vault, backups)
    assert backup_file.exists()
    vault.write_bytes(b"two")
    restore_backup(vault, backup_file)
    assert vault.read_bytes() == b"one"
