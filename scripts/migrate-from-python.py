#!/usr/bin/env python3
"""Export Python Fernet vault to JSON for TypeScript migration.
Usage: python3 migrate-from-python.py [vault_path] [key_path]
"""
import sys, json
from pathlib import Path

vault_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/var/lib/zocket/vault.enc')
key_file   = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('/var/lib/zocket/master.key')

sys.path.insert(0, '/home/zorin/.local/share/zocket/npm-install-source')
from zocket.crypto import load_key, decrypt_payload

key  = load_key(key_file)
data = vault_file.read_bytes()
payload = decrypt_payload(data, key)

json.dump(payload, sys.stdout, indent=2, ensure_ascii=False)
