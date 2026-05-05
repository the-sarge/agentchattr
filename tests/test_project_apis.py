import os
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app  # noqa: E402
import mcp_bridge  # noqa: E402
from agents import AgentTrigger  # noqa: E402
from registry import RuntimeRegistry  # noqa: E402


class ProjectApiPayloadTests(unittest.TestCase):
    def setUp(self):
        self._saved_config = app.config
        self._saved_registry = app.registry
        self._saved_agents = app.agents
        self._saved_project_env = os.environ.get("AGENTCHATTR_PROJECT_CONFIG")
        self._saved_prefix_env = os.environ.get("AGENTCHATTR_TMUX_PREFIX")
        self._presence = dict(mcp_bridge._presence)
        self._activity = dict(mcp_bridge._activity)
        self._activity_ts = dict(mcp_bridge._activity_ts)
        mcp_bridge._presence.clear()
        mcp_bridge._activity.clear()
        mcp_bridge._activity_ts.clear()
        os.environ.pop("AGENTCHATTR_PROJECT_CONFIG", None)
        os.environ.pop("AGENTCHATTR_TMUX_PREFIX", None)

    def tearDown(self):
        app.config = self._saved_config
        app.registry = self._saved_registry
        app.agents = self._saved_agents
        if self._saved_project_env is None:
            os.environ.pop("AGENTCHATTR_PROJECT_CONFIG", None)
        else:
            os.environ["AGENTCHATTR_PROJECT_CONFIG"] = self._saved_project_env
        if self._saved_prefix_env is None:
            os.environ.pop("AGENTCHATTR_TMUX_PREFIX", None)
        else:
            os.environ["AGENTCHATTR_TMUX_PREFIX"] = self._saved_prefix_env
        mcp_bridge._presence.clear()
        mcp_bridge._presence.update(self._presence)
        mcp_bridge._activity.clear()
        mcp_bridge._activity.update(self._activity)
        mcp_bridge._activity_ts.clear()
        mcp_bridge._activity_ts.update(self._activity_ts)

    def test_project_payload_defaults_without_team_file(self):
        app.config = {
            "server": {"port": 8300, "host": "127.0.0.1", "data_dir": "./data"},
            "mcp": {"http_port": 8200, "sse_port": 8201},
            "images": {"upload_dir": "./uploads"},
            "agents": {"builder": {"command": "python"}},
        }

        payload = app._project_payload()

        self.assertEqual(payload["name"], "agentchattr")
        self.assertIsNone(payload["team_file"])
        self.assertEqual(payload["server"]["port"], 8300)
        self.assertEqual(payload["tmux_prefix"], "agentchattr-agentchattr")

    def test_project_payload_uses_project_metadata_and_env_prefix(self):
        os.environ["AGENTCHATTR_TMUX_PREFIX"] = "agentchattr-env"
        app.config = {
            "_meta": {"project_config_path": "/tmp/team.toml"},
            "project": {
                "name": "demo",
                "title": "Demo Room",
                "accent_color": "#10a37f",
                "repo_url": "https://github.com/the-sarge/agentchattr",
                "board_url": "https://github.com/orgs/the-sarge/projects/1",
                "link_label": "Project Board",
                "link_url": "https://github.com/orgs/the-sarge/projects/1/views/1",
            },
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {"builder": {"provider": "codex"}},
        }

        payload = app._project_payload()

        self.assertEqual(payload["name"], "demo")
        self.assertEqual(payload["title"], "Demo Room")
        self.assertEqual(payload["accent_color"], "#10a37f")
        self.assertEqual(payload["repo_url"], "https://github.com/the-sarge/agentchattr")
        self.assertEqual(payload["board_url"], "https://github.com/orgs/the-sarge/projects/1")
        self.assertEqual(payload["link_label"], "Project Board")
        self.assertEqual(payload["link_url"], "https://github.com/orgs/the-sarge/projects/1/views/1")
        self.assertEqual(payload["team_file"], "/tmp/team.toml")
        self.assertEqual(payload["tmux_prefix"], "agentchattr-env")

    def test_channel_name_limit_allows_24_characters(self):
        self.assertRegex("abcdefghijklmnopqrstuvwx", app._CHANNEL_NAME_RE)
        self.assertNotRegex("abcdefghijklmnopqrstuvwxy", app._CHANNEL_NAME_RE)

    def test_agent_ops_payload_flags_configured_registered_and_wrapper_mismatches(self):
        app.config = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {
                "builder": {"provider": "codex", "label": "Builder", "color": "#10a37f", "role": "Builder"},
                "reviewer": {"provider": "claude", "label": "Reviewer", "color": "#da7756"},
            },
        }
        registry = RuntimeRegistry(data_dir="./data/test")
        registry.seed(app.config["agents"])
        registry.register("builder")
        registry._bases.pop("ghost", None)
        app.registry = registry
        app.agents = AgentTrigger(registry, data_dir="./data/test")
        mcp_bridge._presence["builder"] = time.time() - 2
        mcp_bridge._activity["builder"] = True
        mcp_bridge._activity_ts["builder"] = time.time()

        with mock.patch.object(app, "_tmux_sessions", return_value={
            "agentchattr-demo-server",
            "agentchattr-demo-builder",
            "agentchattr-demo-wrap-builder",
            "agentchattr-demo-wrap-reviewer",
        }):
            payload = app._agent_ops_payload()

        self.assertIn("reviewer", payload["mismatches"]["configured_not_registered"])
        self.assertIn("reviewer", payload["mismatches"]["wrapper_running_without_live_heartbeat"])
        builder = next(row for row in payload["configured_agents"] if row["name"] == "builder")
        self.assertTrue(builder["online"])
        self.assertTrue(builder["busy"])
        self.assertEqual(builder["registered_names"], ["builder"])
        self.assertIn("tmux attach -t agentchattr-demo-builder", builder["attach"]["live"])


if __name__ == "__main__":
    unittest.main()
