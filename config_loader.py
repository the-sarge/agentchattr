"""Shared config loader — merges config.toml + config.local.toml.

Used by run.py, wrapper.py, and wrapper_api.py so the server and all
wrappers see the same agent definitions.

Per-invocation overrides: the following environment variables, if set,
override values from config.toml. This lets dotfiles/launcher layers run
isolated instances per project without editing the repo's config file.

  AGENTCHATTR_DATA_DIR        → server.data_dir
  AGENTCHATTR_PORT            → server.port           (int)
  AGENTCHATTR_MCP_HTTP_PORT   → mcp.http_port         (int)
  AGENTCHATTR_MCP_SSE_PORT    → mcp.sse_port          (int)
  AGENTCHATTR_UPLOAD_DIR      → images.upload_dir
  AGENTCHATTR_PROJECT_CONFIG  → extra TOML config overlay for one project/team

Relative paths in env var overrides resolve against the current working
directory (where the user invoked the command from), not agentchattr's
install directory. Relative AGENTCHATTR_PROJECT_CONFIG paths resolve against
agentchattr's install directory so server and wrapper launches agree.
"""

import os
import re
import sys
import tomllib
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).parent
PROJECT_CONFIG_ENV = "AGENTCHATTR_PROJECT_CONFIG"
TMUX_PREFIX_ENV = "AGENTCHATTR_TMUX_PREFIX"
MAX_ROLE_LEN = 20


class ConfigError(ValueError):
    """Raised when a config or team file is structurally invalid."""

_PROVIDER_COMMANDS = {
    "claude": "claude",
    "codex": "codex",
    "gemini": "gemini",
    "kimi": "kimi",
    "qwen": "qwen",
    "kilo": "kilo",
    "codebuddy": "codebuddy",
    "copilot": "copilot",
}
_KNOWN_PROVIDERS = set(_PROVIDER_COMMANDS)
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_AGENT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


# Mapping: env var name → (config section, key, is_int)
_ENV_OVERRIDES = [
    ("AGENTCHATTR_DATA_DIR",      "server", "data_dir",   False),
    ("AGENTCHATTR_PORT",          "server", "port",       True),
    ("AGENTCHATTR_MCP_HTTP_PORT", "mcp",    "http_port",  True),
    ("AGENTCHATTR_MCP_SSE_PORT",  "mcp",    "sse_port",   True),
    ("AGENTCHATTR_UPLOAD_DIR",    "images", "upload_dir", False),
]

# Mapping: CLI flag → env var (for apply_cli_overrides)
CLI_OVERRIDE_FLAGS = [
    ("--data-dir",      "AGENTCHATTR_DATA_DIR"),
    ("--port",          "AGENTCHATTR_PORT"),
    ("--mcp-http-port", "AGENTCHATTR_MCP_HTTP_PORT"),
    ("--mcp-sse-port",  "AGENTCHATTR_MCP_SSE_PORT"),
    ("--upload-dir",    "AGENTCHATTR_UPLOAD_DIR"),
]


def apply_cli_overrides(argv: list[str] | None = None) -> None:
    """Scan argv for --data-dir/--port/etc and set matching env vars in-place.

    Called by run.py, wrapper.py, and wrapper_api.py BEFORE load_config() so
    all entry points respect the same overrides when launched with the same
    flags. No effect if a flag isn't present. Supports both `--flag value`
    and `--flag=value` forms.

    Arguments after a literal `--` are treated as pass-through (e.g. for the
    agent CLI in wrapper.py) and are NOT scanned — `python wrapper.py claude
    -- --port 9999` sets `--port 9999` on the agent, not on agentchattr.
    """
    if argv is None:
        argv = sys.argv

    # Truncate at pass-through separator so agent CLI args don't leak in.
    try:
        end = argv.index("--")
        scan = argv[:end]
    except ValueError:
        scan = argv

    for flag, env in CLI_OVERRIDE_FLAGS:
        # Iterate in order; first match wins (ignore later duplicates).
        for i, arg in enumerate(scan):
            if arg == flag and i + 1 < len(scan):
                os.environ[env] = scan[i + 1]
                break
            if arg.startswith(flag + "="):
                os.environ[env] = arg.split("=", 1)[1]
                break


def _apply_env_overrides(config: dict) -> None:
    """Apply AGENTCHATTR_* env vars to the config dict in-place."""
    for env_var, section, key, is_int in _ENV_OVERRIDES:
        raw = os.environ.get(env_var)
        if raw is None or raw == "":
            continue
        if is_int:
            try:
                value = int(raw)
            except ValueError:
                print(f"  Warning: {env_var}={raw!r} is not a valid integer, ignoring")
                continue
        else:
            # Path values: resolve relative paths against current working dir,
            # not against agentchattr's install directory.
            p = Path(raw)
            if not p.is_absolute():
                p = (Path.cwd() / p).resolve()
            value = str(p)
        config.setdefault(section, {})[key] = value


def _merge_project_config(config: dict, project_config: dict) -> None:
    """Merge a project/team config overlay into the base config.

    Project configs intentionally replace the agent roster when they define
    [agents.*]. That lets a team file be authoritative for "which agents should
    exist for this project" instead of inheriting the default roster.
    """
    for section, value in project_config.items():
        if section == "agents":
            config["agents"] = dict(value)
            continue
        if isinstance(value, dict) and isinstance(config.get(section), dict):
            config[section].update(value)
        else:
            config[section] = value


def _resolve_project_config_path(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    return path


def _load_project_config(config: dict) -> None:
    raw = os.environ.get(PROJECT_CONFIG_ENV, "").strip()
    if not raw:
        return

    path = _resolve_project_config_path(raw)
    with open(path, "rb") as f:
        project_config = tomllib.load(f)
    validate_config(project_config, source=path, require_project=False, check_known_files=False)
    _merge_project_config(config, project_config)
    config.setdefault("_meta", {})["project_config_path"] = str(path)


def _apply_agent_defaults(config: dict) -> None:
    """Merge [agent_defaults.<provider>] into matching agents."""
    defaults = config.get("agent_defaults", {})
    agents = config.get("agents", {})
    if not isinstance(defaults, dict) or not isinstance(agents, dict):
        return

    for name, cfg in list(agents.items()):
        if not isinstance(cfg, dict):
            continue
        provider = str(cfg.get("provider", "")).strip().lower()
        if not provider and str(cfg.get("type", "")).strip().lower() == "api":
            provider = "api"
        provider_defaults = defaults.get(provider)
        if isinstance(provider_defaults, dict):
            agents[name] = {**provider_defaults, **cfg}


def discover_team_files(root: Path | None = None) -> list[Path]:
    """Return known project/team TOML files under teams/ and projects/."""
    root = root or ROOT
    paths: list[Path] = []
    for dirname in ("teams", "projects"):
        directory = root / dirname
        if directory.exists():
            paths.extend(sorted(directory.glob("*.toml")))
    return paths


def _port_value(section: dict, key: str, label: str, errors: list[str]) -> int | None:
    value = section.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        errors.append(f"{label} must be an integer")
        return None
    if not (1 <= value <= 65535):
        errors.append(f"{label} must be between 1 and 65535")
        return None
    return value


def _validate_color(value, label: str, errors: list[str]) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not _HEX_COLOR_RE.match(value):
        errors.append(f"{label} must be a #RRGGBB hex color")


def _validate_http_url(value, label: str, errors: list[str]) -> None:
    if value is None:
        return
    if not isinstance(value, str):
        errors.append(f"{label} must be a string")
        return
    if not value.strip():
        return
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        errors.append(f"{label} must be an http(s) URL")


def _validate_agent(name: str, cfg, errors: list[str]) -> None:
    if not _AGENT_NAME_RE.match(str(name)):
        errors.append(f"[agents.{name}] has an invalid handle; use letters, numbers, _ or -")
    if not isinstance(cfg, dict):
        errors.append(f"[agents.{name}] must be a table")
        return

    agent_type = str(cfg.get("type", "")).strip().lower()
    provider = str(cfg.get("provider", "")).strip().lower()
    command = cfg.get("command")
    if agent_type and agent_type != "api":
        errors.append(f"[agents.{name}].type must be \"api\" when set")
    if provider and provider not in _KNOWN_PROVIDERS:
        errors.append(f"[agents.{name}].provider has unknown provider {provider!r}")
    if command is not None and (not isinstance(command, str) or not command.strip()):
        errors.append(f"[agents.{name}].command must be a non-empty string")
    if agent_type != "api" and not provider and command is None:
        errors.append(f"[agents.{name}] must define provider or command")
    if agent_type == "api":
        if not isinstance(cfg.get("base_url"), str) or not cfg.get("base_url", "").strip():
            errors.append(f"[agents.{name}].base_url is required for API agents")

    _validate_color(cfg.get("color"), f"[agents.{name}].color", errors)

    role = cfg.get("role")
    if role is not None:
        if not isinstance(role, str):
            errors.append(f"[agents.{name}].role must be a string")
        elif len(role.strip()) > MAX_ROLE_LEN:
            errors.append(f"[agents.{name}].role must be {MAX_ROLE_LEN} characters or fewer")

    args = cfg.get("args")
    if args is not None:
        if not isinstance(args, list) or any(not isinstance(arg, str) for arg in args):
            errors.append(f"[agents.{name}].args must be a list of strings")


def _validate_agent_defaults(config: dict, errors: list[str]) -> None:
    defaults = config.get("agent_defaults", {})
    if defaults is None:
        return
    if not isinstance(defaults, dict):
        errors.append("[agent_defaults] must be a table")
        return
    for provider, cfg in defaults.items():
        provider_name = str(provider).strip().lower()
        if provider_name != "api" and provider_name not in _KNOWN_PROVIDERS:
            errors.append(f"[agent_defaults.{provider}] has unknown provider")
        if not isinstance(cfg, dict):
            errors.append(f"[agent_defaults.{provider}] must be a table")
            continue
        command = cfg.get("command")
        if command is not None and (not isinstance(command, str) or not command.strip()):
            errors.append(f"[agent_defaults.{provider}].command must be a non-empty string")
        _validate_color(cfg.get("color"), f"[agent_defaults.{provider}].color", errors)
        role = cfg.get("role")
        if role is not None:
            if not isinstance(role, str):
                errors.append(f"[agent_defaults.{provider}].role must be a string")
            elif len(role.strip()) > MAX_ROLE_LEN:
                errors.append(f"[agent_defaults.{provider}].role must be {MAX_ROLE_LEN} characters or fewer")
        args = cfg.get("args")
        if args is not None and (not isinstance(args, list) or any(not isinstance(arg, str) for arg in args)):
            errors.append(f"[agent_defaults.{provider}].args must be a list of strings")


def validate_config(
    config: dict,
    *,
    source: Path | str = "config",
    require_project: bool = False,
    check_known_files: bool = False,
    root: Path | None = None,
) -> None:
    """Validate the shared config shape."""
    errors: list[str] = []
    label = str(source)

    if not isinstance(config, dict):
        raise ConfigError(f"{label}: config must be a table")

    project = config.get("project", {})
    if project is None:
        project = {}
    if not isinstance(project, dict):
        errors.append("[project] must be a table")
        project = {}
    if require_project and not str(project.get("tmux_prefix", "")).strip():
        errors.append("[project].tmux_prefix is required in team files")
    project_username = project.get("username")
    if project_username is not None and not isinstance(project_username, str):
        errors.append("[project].username must be a string")
    _validate_color(project.get("accent_color"), "[project].accent_color", errors)
    for key in ("repo_url", "github_url", "board_url", "github_project_url", "link_url"):
        _validate_http_url(project.get(key), f"[project].{key}", errors)
    link_label = project.get("link_label")
    if link_label is not None and not isinstance(link_label, str):
        errors.append("[project].link_label must be a string")

    server = config.get("server", {})
    if not isinstance(server, dict):
        errors.append("[server] must be a table")
        server = {}
    _port_value(server, "port", "[server].port", errors)

    mcp = config.get("mcp", {})
    if not isinstance(mcp, dict):
        errors.append("[mcp] must be a table")
        mcp = {}
    _port_value(mcp, "http_port", "[mcp].http_port", errors)
    _port_value(mcp, "sse_port", "[mcp].sse_port", errors)

    agents = config.get("agents", {})
    if not isinstance(agents, dict) or not agents:
        errors.append("config must define at least one [agents.<name>] entry")
    else:
        for name, cfg in agents.items():
            _validate_agent(str(name), cfg, errors)

    _validate_agent_defaults(config, errors)

    if errors:
        joined = "\n  - ".join(errors)
        raise ConfigError(f"{label} is invalid:\n  - {joined}")
    if check_known_files:
        validate_known_team_files(root=root or ROOT)


def validate_known_team_files(root: Path | None = None) -> None:
    """Validate known teams/projects for duplicate tmux prefixes and ports."""
    root = root or ROOT
    errors: list[str] = []
    prefixes: dict[str, Path] = {}
    ports: dict[int, tuple[Path, str]] = {}

    for path in discover_team_files(root):
        try:
            with open(path, "rb") as f:
                team = tomllib.load(f)
            validate_config(team, source=path, require_project=True, check_known_files=False, root=root)
        except (OSError, tomllib.TOMLDecodeError, ConfigError) as exc:
            errors.append(str(exc))
            continue

        project = team.get("project", {}) if isinstance(team.get("project", {}), dict) else {}
        prefix = str(project.get("tmux_prefix", "")).strip()
        if prefix:
            if prefix in prefixes:
                errors.append(f"{path}: duplicate tmux_prefix {prefix!r} also used by {prefixes[prefix]}")
            else:
                prefixes[prefix] = path

        for section, key, port in (
            ("server", "port", team.get("server", {}).get("port") if isinstance(team.get("server"), dict) else None),
            ("mcp", "http_port", team.get("mcp", {}).get("http_port") if isinstance(team.get("mcp"), dict) else None),
            ("mcp", "sse_port", team.get("mcp", {}).get("sse_port") if isinstance(team.get("mcp"), dict) else None),
        ):
            if isinstance(port, int) and not isinstance(port, bool):
                existing = ports.get(port)
                port_label = f"[{section}].{key}"
                if existing:
                    errors.append(
                        f"{path}: duplicate port {port} for {port_label}; "
                        f"also used by {existing[0]} {existing[1]}"
                    )
                else:
                    ports[port] = (path, port_label)

    if errors:
        joined = "\n  - ".join(errors)
        raise ConfigError(f"Known team files are invalid:\n  - {joined}")


def load_project_config_file(path: Path, root: Path | None = None) -> dict:
    """Load the full config as if AGENTCHATTR_PROJECT_CONFIG pointed at path."""
    root = root or ROOT
    previous = os.environ.get(PROJECT_CONFIG_ENV)
    os.environ[PROJECT_CONFIG_ENV] = str(path)
    try:
        return load_config(root)
    finally:
        if previous is None:
            os.environ.pop(PROJECT_CONFIG_ENV, None)
        else:
            os.environ[PROJECT_CONFIG_ENV] = previous


def _normalize_agent_defaults(config: dict) -> None:
    """Fill implied fields for provider-based agent aliases.

    Team configs commonly use a stable handle such as [agents.architect] with
    provider = "claude". The wrapper still needs a concrete command, so infer
    command = "claude" when it is not specified.
    """
    for cfg in config.get("agents", {}).values():
        if not isinstance(cfg, dict):
            continue
        provider = str(cfg.get("provider", "")).strip().lower()
        if provider and "command" not in cfg and provider in _PROVIDER_COMMANDS:
            cfg["command"] = _PROVIDER_COMMANDS[provider]


def load_config(root: Path | None = None) -> dict:
    """Load config.toml and merge config.local.toml if it exists.

    config.local.toml is gitignored and intended for user-specific agents
    (e.g. local LLM endpoints) that shouldn't be committed.
    Only the [agents] section is merged — local entries are added alongside
    (not replacing) the agents defined in config.toml.

    AGENTCHATTR_* environment variables override values from config.toml
    (see module docstring for the list).
    """
    root = root or ROOT
    config_path = root / "config.toml"

    with open(config_path, "rb") as f:
        config = tomllib.load(f)

    local_path = root / "config.local.toml"
    if local_path.exists():
        with open(local_path, "rb") as f:
            local = tomllib.load(f)

        # Merge [agents] section — local agents are added ONLY if they don't already exist.
        # This protects the "holy trinity" (claude, codex, gemini) from being overridden.
        local_agents = local.get("agents", {})
        config_agents = config.setdefault("agents", {})
        for name, agent_cfg in local_agents.items():
            if name not in config_agents:
                config_agents[name] = agent_cfg
            else:
                print(f"  Warning: Ignoring local agent '{name}' (already defined in config.toml)")

    _load_project_config(config)
    _apply_agent_defaults(config)
    _normalize_agent_defaults(config)
    _apply_env_overrides(config)
    validate_config(config, source=config.get("_meta", {}).get("project_config_path", config_path))
    if config.get("_meta", {}).get("project_config_path"):
        validate_known_team_files(root)

    return config
