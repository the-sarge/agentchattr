import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import config_loader  # noqa: E402


class ConfigSchemaTests(unittest.TestCase):
    def setUp(self):
        self._project_env = os.environ.get(config_loader.PROJECT_CONFIG_ENV)
        os.environ.pop(config_loader.PROJECT_CONFIG_ENV, None)

    def tearDown(self):
        if self._project_env is None:
            os.environ.pop(config_loader.PROJECT_CONFIG_ENV, None)
        else:
            os.environ[config_loader.PROJECT_CONFIG_ENV] = self._project_env

    def test_agent_defaults_merge_before_agent_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "config.toml").write_text(
                """
[server]
port = 8300

[agent_defaults.claude]
cwd = "../default"
args = ["--model", "sonnet"]
color = "#111111"

[agents.architect]
provider = "claude"
cwd = "../project"
label = "Architect"
color = "#222222"
""".strip(),
                "utf-8",
            )

            config = config_loader.load_config(root)

        agent = config["agents"]["architect"]
        self.assertEqual(agent["cwd"], "../project")
        self.assertEqual(agent["args"], ["--model", "sonnet"])
        self.assertEqual(agent["color"], "#222222")
        self.assertEqual(agent["command"], "claude")

    def test_project_metadata_and_args_load_from_team_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "config.toml").write_text(
                """
[server]
port = 8300

[agents.default]
command = "python"
""".strip(),
                "utf-8",
            )
            project = root / "team.toml"
            project.write_text(
                """
[project]
name = "roadmap"
title = "Roadmap Room"
username = "josh"
accent_color = "#10a37f"
tmux_prefix = "agentchattr-roadmap"
repo_url = "https://github.com/the-sarge/agentchattr"
board_url = "https://github.com/orgs/the-sarge/projects/1"
link_label = "Project Board"
link_url = "https://github.com/orgs/the-sarge/projects/1/views/1"

[server]
port = 8310

[agents.builder]
provider = "codex"
args = ["--profile", "work"]
color = "#10a37f"
role = "Builder"
team = "1"
""".strip(),
                "utf-8",
            )
            os.environ[config_loader.PROJECT_CONFIG_ENV] = str(project)

            config = config_loader.load_config(root)

        self.assertEqual(config["project"]["title"], "Roadmap Room")
        self.assertEqual(config["project"]["username"], "josh")
        self.assertEqual(config["project"]["accent_color"], "#10a37f")
        self.assertEqual(config["project"]["repo_url"], "https://github.com/the-sarge/agentchattr")
        self.assertEqual(config["project"]["board_url"], "https://github.com/orgs/the-sarge/projects/1")
        self.assertEqual(config["project"]["link_label"], "Project Board")
        self.assertEqual(config["project"]["link_url"], "https://github.com/orgs/the-sarge/projects/1/views/1")
        self.assertEqual(config["server"]["port"], 8310)
        self.assertEqual(list(config["agents"].keys()), ["builder"])
        self.assertEqual(config["agents"]["builder"]["team"], "1")
        self.assertEqual(config["agents"]["builder"]["args"], ["--profile", "work"])
        self.assertEqual(config["agents"]["builder"]["command"], "codex")

    def test_invalid_color_and_role_raise(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-bad", "accent_color": "blue"},
            "server": {"port": 8300},
            "agents": {
                "bad": {
                    "provider": "claude",
                    "color": "#xyz",
                    "role": "this role name is far too long",
                }
            },
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="bad.toml", require_project=True)
        msg = str(ctx.exception)
        self.assertIn("accent_color", msg)
        self.assertIn("color", msg)
        self.assertIn("role", msg)

    def test_invalid_agent_team_raises(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-bad-team"},
            "server": {"port": 8300},
            "agents": {
                "bad": {
                    "provider": "claude",
                    "team": 1,
                }
            },
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="bad-team.toml", require_project=True)

        self.assertIn("team", str(ctx.exception))

    def test_invalid_routing_metadata_characters_raise(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-bad-route-meta"},
            "server": {"port": 8300},
            "agents": {
                "builder": {
                    "provider": "codex",
                    "role": "Build/Review",
                    "team": "cmx:1",
                }
            },
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="bad-route-meta.toml", require_project=True)

        msg = str(ctx.exception)
        self.assertIn("[agents.builder].role", msg)
        self.assertIn("[agents.builder].team", msg)

    def test_repeated_routing_metadata_separators_raise(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-bad-route-separators"},
            "server": {"port": 8300},
            "agents": {
                "builder": {
                    "provider": "codex",
                    "role": "Code  Review",
                    "team": "a..b",
                }
            },
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="bad-route-separators.toml", require_project=True)

        msg = str(ctx.exception)
        self.assertIn("[agents.builder].role", msg)
        self.assertIn("[agents.builder].team", msg)

    def test_duplicate_agent_labels_raise(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-duplicate-labels"},
            "server": {"port": 8300},
            "agents": {
                "builder": {"provider": "codex", "label": "Worker"},
                "reviewer": {"provider": "claude", "label": "worker"},
            },
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="duplicate-labels.toml", require_project=True)

        self.assertIn("duplicates [agents.builder].label", str(ctx.exception))

    def test_duplicate_agent_labels_from_defaults_raise(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-default-labels"},
            "server": {"port": 8300},
            "agent_defaults": {
                "codex": {"label": "Worker"},
            },
            "agents": {
                "builder": {"provider": "codex"},
                "tester": {"provider": "codex"},
            },
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="default-labels.toml", require_project=True)

        self.assertIn("duplicates [agents.builder].label", str(ctx.exception))

    def test_agent_defaults_validate_label_team_and_cwd(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-bad-defaults"},
            "server": {"port": 8300},
            "agent_defaults": {
                "codex": {
                    "label": "",
                    "team": "cmx/1",
                    "cwd": "",
                },
            },
            "agents": {
                "builder": {"provider": "codex"},
            },
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="bad-defaults.toml", require_project=True)

        msg = str(ctx.exception)
        self.assertIn("[agent_defaults.codex].label", msg)
        self.assertIn("[agent_defaults.codex].team", msg)
        self.assertIn("[agent_defaults.codex].cwd", msg)

    def test_invalid_project_urls_raise(self):
        bad = {
            "project": {
                "tmux_prefix": "agentchattr-bad-url",
                "repo_url": "javascript:alert(1)",
                "board_url": "github.com/orgs/demo/projects/1",
                "link_url": 123,
            },
            "server": {"port": 8300},
            "agents": {"one": {"provider": "claude"}},
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="bad-url.toml", require_project=True)
        msg = str(ctx.exception)
        self.assertIn("repo_url", msg)
        self.assertIn("board_url", msg)
        self.assertIn("link_url", msg)

    def test_invalid_project_username_raises(self):
        bad = {
            "project": {"tmux_prefix": "agentchattr-bad-user", "username": 123},
            "server": {"port": 8300},
            "agents": {"one": {"provider": "claude"}},
        }
        with self.assertRaises(config_loader.ConfigError) as ctx:
            config_loader.validate_config(bad, source="bad-user.toml", require_project=True)
        self.assertIn("[project].username", str(ctx.exception))

    def test_duplicate_known_team_ports_and_prefixes_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            teams = root / "teams"
            teams.mkdir()
            body = """
[project]
name = "{name}"
tmux_prefix = "{prefix}"

[server]
port = {server_port}

[mcp]
http_port = {http_port}
sse_port = {sse_port}

[agents.one]
provider = "claude"
""".strip()
            (teams / "a.toml").write_text(
                body.format(name="a", prefix="agentchattr-same", server_port=8310, http_port=8210, sse_port=8211),
                "utf-8",
            )
            (teams / "b.toml").write_text(
                body.format(name="b", prefix="agentchattr-same", server_port=8310, http_port=8220, sse_port=8221),
                "utf-8",
            )

            with self.assertRaises(config_loader.ConfigError) as ctx:
                config_loader.validate_known_team_files(root)

        msg = str(ctx.exception)
        self.assertIn("duplicate tmux_prefix", msg)
        self.assertIn("duplicate port 8310", msg)


if __name__ == "__main__":
    unittest.main()
