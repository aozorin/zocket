from typing import Literal

from mcp.server.fastmcp import FastMCP

from .audit import AuditLogger
from .config_store import ConfigStore
from .paths import config_path
from .runner import ExecPolicyError, run_with_env_limited
from .vault import ProjectNotFoundError, SecretNotFoundError, ValidationError, VaultService

MCPMode = Literal["metadata", "admin"]

MCP_INSTRUCTIONS = (
    "Zocket MCP provides project metadata and a safe command runner. "
    "Secret values are never returned. To use secrets, call run_with_project_env "
    "and pass command arguments with $VAR or ${VAR} placeholders. "
    "Those placeholders are substituted from the project environment before execution. "
    "Do not try to print or exfiltrate secrets."
)


def _public_project_metadata(rows: list[dict]) -> list[dict]:
    return [
        {
            "project": row.get("project"),
            "folder_path": row.get("folder_path"),
            "secret_count": row.get("secret_count"),
            "updated_at": row.get("updated_at"),
        }
        for row in rows
    ]


def _public_key_metadata(rows: list[dict]) -> list[dict]:
    return [
        {
            "key": row.get("key"),
            "has_value": row.get("has_value"),
            "updated_at": row.get("updated_at"),
        }
        for row in rows
    ]


def create_server(
    vault: VaultService,
    mode: MCPMode = "metadata",
    audit: AuditLogger | None = None,
    host: str = "127.0.0.1",
    port: int = 18002,
) -> FastMCP:
    mcp = FastMCP(name="zocket", host=host, port=port, instructions=MCP_INSTRUCTIONS)

    def _exec_policy() -> tuple[list[str], bool, int, bool, bool]:
        cfg = ConfigStore(config_path()).load()
        allowlist = cfg.get("exec_allowlist") or []
        return_output = bool(cfg.get("exec_return_output", False))
        allow_full_output = bool(cfg.get("exec_allow_full_output", False))
        substitute_env = bool(cfg.get("exec_substitute_env", True))
        try:
            max_output = int(cfg.get("exec_max_output_chars", 0))
        except (TypeError, ValueError):
            max_output = 0
        if not return_output:
            max_output = 0
        return allowlist, return_output, max_output, allow_full_output, substitute_env

    @mcp.tool(
        description=(
            "List all known projects from local zocket vault. "
            "Secret values are never returned."
        )
    )
    def list_projects() -> list:
        if audit:
            audit.log("mcp.list_projects", "ok", "mcp")
        return _public_project_metadata(vault.list_projects())

    @mcp.tool(
        description=(
            "List secret keys for a project without returning secret values."
        )
    )
    def list_project_keys(project: str) -> list:
        if audit:
            audit.log("mcp.list_project_keys", "ok", "mcp", {"project": project})
        return _public_key_metadata(
            vault.list_project_secrets(project, include_values=False)
        )

    @mcp.tool(
        description=(
            "Find a project by local filesystem path. "
            "Returns best match by longest folder prefix."
        )
    )
    def find_project_by_path(path: str) -> dict:
        match = vault.find_project_by_path(path)
        if audit:
            audit.log(
                "mcp.find_project_by_path",
                "ok",
                "mcp",
                {"path": path, "matched": bool(match)},
            )
        if not match:
            return {"status": "not_found"}
        return {
            "status": "ok",
            "project": match.get("project"),
            "folder_path": match.get("folder_path"),
            "secret_count": match.get("secret_count"),
            "updated_at": match.get("updated_at"),
        }

    if mode == "admin":
        @mcp.tool(
            description=(
                "Create or update a secret for project. "
                "Use env-like key names, e.g. SSH_HOST / SSH_PASSWORD."
            )
        )
        def upsert_secret(
            project: str, key: str, value: str, description: str = ""
        ) -> dict:
            vault.upsert_secret(project=project, key=key, value=value, description=description)
            if audit:
                audit.log("mcp.upsert_secret", "ok", "mcp", {"project": project, "key": key})
            return {"status": "ok", "message": f"Saved {key} in project {project}"}

        @mcp.tool(description="Delete a secret key from project.")
        def delete_secret(project: str, key: str) -> dict:
            vault.delete_secret(project=project, key=key)
            if audit:
                audit.log("mcp.delete_secret", "ok", "mcp", {"project": project, "key": key})
            return {"status": "ok", "message": f"Deleted {key} from project {project}"}

        @mcp.tool(description="Delete project and all its secrets.")
        def delete_project(project: str) -> dict:
            vault.delete_project(project=project)
            if audit:
                audit.log("mcp.delete_project", "ok", "mcp", {"project": project})
            return {"status": "ok", "message": f"Deleted project {project}"}

        @mcp.tool(
            description=(
                "Run local command with project secrets injected into process ENV. "
                "Secret values are not returned and output is redacted."
            )
        )
        def run_with_project_env(project: str, command: list, full_output: bool = False) -> dict:
            if not isinstance(command, list) or not command:
                return {"status": "error", "error": "Command must be a non-empty list."}
            env = vault.get_project_env(project)
            allowlist, return_output, max_output, allow_full_output, substitute_env = _exec_policy()
            if full_output and not allow_full_output:
                return {"status": "denied", "error": "Full output is not allowed."}
            output_limit = None if full_output else (max_output if return_output else 0)
            try:
                result = run_with_env_limited(
                    command=command,
                    project_env=env,
                    allowlist=allowlist,
                    max_output_chars=output_limit,
                    substitute_env=substitute_env,
                )
            except ExecPolicyError as exc:
                if audit:
                    audit.log(
                        "mcp.run_with_project_env",
                        "denied",
                        "mcp",
                        {"project": project, "reason": str(exc)},
                    )
                return {"status": "denied", "error": str(exc)}
            if audit:
                audit.log(
                    "mcp.run_with_project_env",
                    "ok",
                    "mcp",
                    {"project": project, "exit_code": result.exit_code},
                )
            payload = {"status": "ok", "exit_code": result.exit_code}
            if full_output or return_output:
                payload["stdout"] = result.stdout
                payload["stderr"] = result.stderr
            return payload

        @mcp.tool(
            description=(
                "Describe execution policy for run_with_project_env, including "
                "allowed commands, output limits, and whether ${VAR} substitution is enabled."
            )
        )
        def get_exec_policy() -> dict:
            allowlist, return_output, max_output, allow_full_output, substitute_env = _exec_policy()
            return {
                "status": "ok",
                "allowlist": allowlist,
                "return_output": return_output,
                "max_output_chars": max_output,
                "allow_full_output": allow_full_output,
                "substitute_env": substitute_env,
            }

        @mcp.tool(
            description=(
                "Create an empty project. This is optional, because upsert_secret "
                "creates project automatically."
            )
        )
        def create_project(
            project: str, description: str = "", folder_path: str = ""
        ) -> dict:
            vault.create_project(
                project=project,
                description=description,
                folder_path=folder_path,
            )
            if audit:
                audit.log("mcp.create_project", "ok", "mcp", {"project": project})
            return {"status": "ok", "message": f"Project created: {project}"}

    @mcp.tool(
        description=(
            "Health check for zocket MCP server. Use this to verify server is alive."
        )
    )
    def ping() -> dict:
        if audit:
            audit.log("mcp.ping", "ok", "mcp", {"mode": mode})
        return {"status": "ok", "name": "zocket", "mode": mode}

    return mcp


def run_server(
    vault: VaultService,
    transport: Literal["stdio", "sse", "streamable-http"] = "stdio",
    mode: MCPMode = "metadata",
    audit: AuditLogger | None = None,
    host: str = "127.0.0.1",
    port: int = 18002,
) -> None:
    server = create_server(vault, mode=mode, audit=audit, host=host, port=port)
    try:
        server.run(transport=transport)
    except (ValidationError, ProjectNotFoundError, SecretNotFoundError) as exc:
        raise RuntimeError(str(exc)) from exc
