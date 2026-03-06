# Local Models (Ollama / Hugging Face) with zocket Workflows

zocket itself is model-agnostic.  
You can use local models in agent clients while zocket provides secrets/MCP.

## 1) Ollama (local)

Start Ollama and pull a model:
```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

Ollama OpenAI-compatible endpoint is typically:
```text
http://127.0.0.1:11434/v1
```

### OpenCode + Ollama

`~/.config/opencode/opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "opencode-ollama",
      "name": "Ollama",
      "models": {
        "qwen2.5-coder:7b": {}
      }
    }
  },
  "agent": {
    "coder": {
      "model": "ollama/qwen2.5-coder:7b"
    }
  }
}
```

### Qwen CLI + Ollama (OpenAI-compatible)

`~/.qwen/settings.json`:
```json
{
  "modelProviders": {
    "local_ollama": {
      "name": "Local Ollama",
      "baseURL": "http://127.0.0.1:11434/v1",
      "apiKey": "ollama",
      "models": ["qwen2.5-coder:7b"]
    }
  },
  "model": "local_ollama/qwen2.5-coder:7b"
}
```

## 2) Hugging Face local models

Recommended path:
- run local Text Generation Inference (TGI) server
- expose OpenAI-compatible endpoint
- connect client via custom provider settings

Typical local endpoint:
```text
http://127.0.0.1:8080/v1
```

Example (Qwen CLI custom provider):
```json
{
  "modelProviders": {
    "local_hf_tgi": {
      "name": "HF TGI Local",
      "baseURL": "http://127.0.0.1:8080/v1",
      "apiKey": "hf-local",
      "models": ["Qwen/Qwen2.5-Coder-7B-Instruct"]
    }
  },
  "model": "local_hf_tgi/Qwen/Qwen2.5-Coder-7B-Instruct"
}
```

## 3) Clients that are primarily cloud-first

- Codex CLI / Claude / Antigravity are primarily documented for hosted model backends.
- Keep zocket MCP integration enabled independently from model backend choice.

## 4) Security notes

- Keep local model APIs on loopback only (`127.0.0.1`).
- Do not expose local model endpoints publicly without auth and TLS.
- Keep zocket in `metadata` mode by default for MCP clients.
