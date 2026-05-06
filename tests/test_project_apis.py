import asyncio
import os
import socket
import sys
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app  # noqa: E402
import mcp_bridge  # noqa: E402
from agents import AgentTrigger  # noqa: E402
from registry import RuntimeRegistry  # noqa: E402
from router import Router  # noqa: E402


class FakeRequest:
    def __init__(self, payload=None, headers=None):
        self._payload = payload or {}
        self.headers = headers or {}

    async def json(self):
        return self._payload


class ProjectApiPayloadTests(unittest.TestCase):
    def setUp(self):
        self._saved_config = app.config
        self._saved_registry = app.registry
        self._saved_agents = app.agents
        self._saved_router = app.router
        self._saved_project_env = os.environ.get("AGENTCHATTR_PROJECT_CONFIG")
        self._saved_prefix_env = os.environ.get("AGENTCHATTR_TMUX_PREFIX")
        self._presence = dict(mcp_bridge._presence)
        self._activity = dict(mcp_bridge._activity)
        self._activity_ts = dict(mcp_bridge._activity_ts)
        self._roles = dict(mcp_bridge._roles)
        mcp_bridge._presence.clear()
        mcp_bridge._activity.clear()
        mcp_bridge._activity_ts.clear()
        mcp_bridge._roles.clear()
        os.environ.pop("AGENTCHATTR_PROJECT_CONFIG", None)
        os.environ.pop("AGENTCHATTR_TMUX_PREFIX", None)

    def tearDown(self):
        app.config = self._saved_config
        app.registry = self._saved_registry
        app.agents = self._saved_agents
        app.router = self._saved_router
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
        mcp_bridge._roles.clear()
        mcp_bridge._roles.update(self._roles)

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

    def test_project_username_seeds_settings_when_no_saved_username_exists(self):
        saved_room_settings = dict(app.room_settings)
        with tempfile.TemporaryDirectory() as tmp:
            try:
                app.room_settings = {
                    "title": "agentchattr",
                    "username": "user",
                    "font": "sans",
                    "channels": ["general"],
                    "history_limit": "all",
                    "contrast": "normal",
                    "max_agent_hops": 100,
                    "custom_roles": [],
                }
                app.config = {
                    "project": {"username": "josh"},
                    "server": {"data_dir": tmp},
                }

                app._load_settings()

                self.assertEqual(app.room_settings["username"], "josh")
            finally:
                app.room_settings = saved_room_settings

    def test_saved_username_wins_over_project_username(self):
        saved_room_settings = dict(app.room_settings)
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "settings.json").write_text(json.dumps({"username": "saved-name"}), "utf-8")
            try:
                app.room_settings = {
                    "title": "agentchattr",
                    "username": "user",
                    "font": "sans",
                    "channels": ["general"],
                    "history_limit": "all",
                    "contrast": "normal",
                    "max_agent_hops": 100,
                    "custom_roles": [],
                }
                app.config = {
                    "project": {"username": "josh"},
                    "server": {"data_dir": tmp},
                }

                app._load_settings()

                self.assertEqual(app.room_settings["username"], "saved-name")
            finally:
                app.room_settings = saved_room_settings

    def test_agent_ops_payload_flags_configured_registered_and_wrapper_mismatches(self):
        app.config = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {
                "builder": {"provider": "codex", "label": "Builder", "color": "#10a37f", "role": "Builder", "team": "1"},
                "reviewer": {"provider": "claude", "label": "Reviewer", "color": "#da7756", "team": "2"},
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
        detail_kinds = {item["kind"] for item in payload["mismatches"]["details"]}
        self.assertIn("configured_not_registered", detail_kinds)
        self.assertIn("wrapper_running_without_live_heartbeat", detail_kinds)
        builder = next(row for row in payload["configured_agents"] if row["name"] == "builder")
        self.assertTrue(builder["online"])
        self.assertTrue(builder["busy"])
        self.assertEqual(builder["registered_names"], ["builder"])
        self.assertEqual(builder["team"], "1")
        self.assertIn("tmux attach -t agentchattr-demo-builder", builder["attach"]["live"])
        running_builder = next(row for row in payload["registered_agents"] if row["name"] == "builder")
        self.assertEqual(running_builder["team"], "1")
        self.assertEqual(app.registry.get_agent_config()["builder"]["team"], "1")

    def test_agent_ops_endpoint_builds_payload_off_event_loop(self):
        with mock.patch.object(app.asyncio, "to_thread", new=mock.AsyncMock(return_value={"ok": True})) as to_thread:
            payload = asyncio.run(app.get_agent_ops())

        self.assertEqual(payload, {"ok": True})
        to_thread.assert_called_once_with(app._agent_ops_payload)

    def test_agent_ops_team_survives_slot_one_rename(self):
        app.config = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {
                "builder": {"provider": "codex", "label": "Builder", "color": "#10a37f", "team": "1"},
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registry.register("builder")
            registry.register("builder")
            app.registry = registry
            app.agents = AgentTrigger(registry, data_dir=tmp)

            with mock.patch.object(app, "_tmux_sessions", return_value={
                "agentchattr-demo-builder",
                "agentchattr-demo-builder-2",
            }):
                payload = app._agent_ops_payload()

        rows = {row["name"]: row for row in payload["registered_agents"]}
        self.assertEqual(rows["builder-1"]["team"], "1")
        self.assertEqual(rows["builder-2"]["team"], "1")
        self.assertEqual(app.registry.get_agent_config()["builder-1"]["team"], "1")
        self.assertEqual(app.registry.get_agent_config()["builder-2"]["team"], "1")

    def test_agent_ops_service_badges_report_ports_and_loop_guard(self):
        saved_room_settings = dict(app.room_settings)
        try:
            app.room_settings = {
                **saved_room_settings,
                "channels": ["general", "debug"],
                "max_agent_hops": 3,
            }
            app.config = {
                "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
                "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
                "mcp": {"http_port": 8290, "sse_port": 8291},
                "images": {"upload_dir": "./uploads/demo"},
                "agents": {},
            }
            app.registry = RuntimeRegistry(data_dir="./data/test")
            app.agents = AgentTrigger(app.registry, data_dir="./data/test")
            app.router = Router([], max_hops=3)
            app.router._get_ch("debug")["paused"] = True

            def port_open(_host, port, timeout=0.08):
                return int(port) in {8390, 8290}

            with mock.patch.object(app, "_tmux_sessions", return_value={"agentchattr-demo-server"}), \
                    mock.patch.object(app, "_tcp_port_open", side_effect=port_open):
                payload = app._agent_ops_payload()
        finally:
            app.room_settings = saved_room_settings

        services = {svc["name"]: svc for svc in payload["service_badges"]}
        self.assertEqual(services["server"]["status"], "running")
        self.assertEqual(services["server"]["severity"], "ok")
        self.assertEqual(services["mcp-http"]["status"], "listening")
        self.assertEqual(services["mcp-sse"]["status"], "closed")
        self.assertEqual(services["mcp-sse"]["severity"], "warn")
        self.assertEqual(services["loop-guard"]["status"], "paused")
        self.assertEqual(services["loop-guard"]["paused_channels"], ["debug"])

    def test_agent_ops_server_badge_state_matrix(self):
        app.config = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {},
        }
        app.registry = RuntimeRegistry(data_dir="./data/test")
        app.agents = AgentTrigger(app.registry, data_dir="./data/test")
        app.router = Router([], max_hops=3)
        cases = [
            (True, True, "running", "ok"),
            (False, True, "listening", "warn"),
            (True, False, "tmux only", "warn"),
            (False, False, "stopped", "down"),
        ]
        for tmux_running, port_open, status, severity in cases:
            with self.subTest(tmux_running=tmux_running, port_open=port_open):
                sessions = {"agentchattr-demo-server"} if tmux_running else set()
                with mock.patch.object(app, "_tmux_sessions", return_value=sessions), \
                        mock.patch.object(app, "_tcp_port_open", return_value=port_open):
                    payload = app._agent_ops_payload()

                server = next(svc for svc in payload["service_badges"] if svc["name"] == "server")
                self.assertEqual(server["status"], status)
                self.assertEqual(server["severity"], severity)

    def test_tcp_port_open_validates_and_logs_unexpected_socket_errors(self):
        self.assertFalse(app._tcp_port_open("127.0.0.1", 0))
        self.assertFalse(app._tcp_port_open("127.0.0.1", "not-a-port"))
        with mock.patch.object(app.socket, "create_connection", side_effect=ConnectionRefusedError):
            self.assertFalse(app._tcp_port_open("127.0.0.1", 8390))
        with mock.patch.object(app.socket, "create_connection", side_effect=socket.gaierror("bad host")):
            with self.assertLogs(app.log, level="DEBUG") as captured:
                self.assertFalse(app._tcp_port_open("bad.local", 8390))
        self.assertIn("port probe failed for bad.local:8390: gaierror", captured.output[0])

    def test_bearer_auth_allowlist_includes_message_window_only_for_read_api(self):
        self.assertTrue(app._allows_bearer_auth("/api/messages"))
        self.assertTrue(app._allows_bearer_auth("/api/messages/window"))
        self.assertTrue(app._allows_bearer_auth("/api/send"))
        self.assertTrue(app._allows_bearer_auth("/api/rules/active"))
        self.assertFalse(app._allows_bearer_auth("/api/search"))
        self.assertFalse(app._allows_bearer_auth("/api/export"))

    def test_message_window_bearer_auth_through_middleware(self):
        saved_session_token = app.session_token
        try:
            with tempfile.TemporaryDirectory() as tmp:
                registry = RuntimeRegistry(data_dir=tmp)
                registry.seed({"builder": {"provider": "codex"}})
                registered = registry.register("builder")
                app.registry = registry
                app.session_token = "browser-token"

                probe_app = FastAPI()

                @probe_app.get("/api/messages/window")
                async def message_window_probe():
                    return {"ok": True}

                @probe_app.get("/api/search")
                async def search_probe():
                    return {"ok": True}

                probe_app.add_middleware(app._security_middleware_class({"server": {"port": 8390}}))
                client = TestClient(probe_app)
                bearer = {"Authorization": f"Bearer {registered['token']}"}

                allowed = client.get("/api/messages/window", headers=bearer)
                missing_token = client.get("/api/messages/window")
                denied_bearer = client.get("/api/search", headers=bearer)

            self.assertEqual(allowed.status_code, 200)
            self.assertEqual(allowed.json(), {"ok": True})
            self.assertEqual(missing_token.status_code, 403)
            self.assertEqual(denied_bearer.status_code, 403)
        finally:
            app.session_token = saved_session_token

    def test_sync_router_agents_includes_team_and_role_metadata(self):
        app.config = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {
                "builder": {"provider": "codex", "label": "Builder", "color": "#10a37f", "team": "1"},
                "reviewer": {"provider": "codex", "label": "Reviewer", "color": "#10a37f", "team": "1"},
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registry.register("builder")
            registry.register("reviewer")
            app.registry = registry
            app.router = Router([], default_mention="none")
            mcp_bridge._roles["builder"] = "Builder"
            mcp_bridge._roles["reviewer"] = "Reviewer"

            app._sync_router_agents()

        self.assertEqual(set(app.router.parse_mentions("@team:1")), {"builder", "reviewer"})
        self.assertEqual(set(app.router.parse_mentions("@role:Builder")), {"builder"})

    def test_set_agent_role_invokes_router_sync(self):
        app.config = {
            "agents": {"builder": {"provider": "codex", "label": "Builder"}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registry.register("builder")
            app.registry = registry
            app.router = Router(["builder"], default_mention="none")

            with mock.patch.object(app, "_sync_router_agents", return_value=True) as sync:
                with mock.patch.object(app, "broadcast_status", new=mock.AsyncMock()):
                    response = asyncio.run(app.set_agent_role("builder", FakeRequest({"role": "Reviewer"})))

        self.assertEqual(response.status_code, 200)
        sync.assert_called_once_with(report_missing=True)
        self.assertEqual(mcp_bridge.get_role("builder"), "Reviewer")

    def test_set_agent_role_rejects_base_family_without_active_instance(self):
        app.config = {
            "agents": {"builder": {"provider": "codex", "label": "Builder"}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registry.register("builder")
            registry.register("builder")
            app.registry = registry
            app.router = Router(["builder-1", "builder-2"], default_mention="none")

            with mock.patch.object(app, "broadcast_status", new=mock.AsyncMock()):
                response = asyncio.run(app.set_agent_role("builder", FakeRequest({"role": "Reviewer"})))

        self.assertEqual(response.status_code, 404)
        self.assertNotIn("builder", mcp_bridge.get_all_roles())

    def test_set_agent_role_returns_503_when_router_sync_unavailable(self):
        app.registry = RuntimeRegistry(data_dir="./data/test")
        app.router = None

        with self.assertLogs(app.log, level="ERROR") as captured:
            response = asyncio.run(app.set_agent_role("builder", FakeRequest({"role": "Reviewer"})))

        self.assertEqual(response.status_code, 503)
        self.assertIn("Router metadata sync unavailable for set_agent_role", captured.output[0])

    def test_deregister_agent_invokes_router_sync(self):
        app.config = {
            "agents": {"builder": {"provider": "codex", "label": "Builder"}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registered = registry.register("builder")
            app.registry = registry
            app.router = Router(["builder"], default_mention="none")
            request = FakeRequest(headers={"authorization": f"Bearer {registered['token']}"})

            with mock.patch.object(app, "_sync_router_agents", return_value=True) as sync:
                response = asyncio.run(app.deregister_agent("builder", request))

        self.assertEqual(response.status_code, 200)
        sync.assert_called_once_with(report_missing=True)

    def test_agent_ops_prefers_existing_legacy_live_session_for_default_prefix(self):
        app.config = {
            "project": {"name": "agentchattr"},
            "server": {"port": 8300, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8200, "sse_port": 8201},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {
                "claude": {"provider": "claude", "label": "Claude", "color": "#da7756"},
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registry.register("claude")
            app.registry = registry
            app.agents = AgentTrigger(registry, data_dir=tmp)

            with mock.patch.object(app, "_tmux_sessions", return_value={"agentchattr-claude"}):
                payload = app._agent_ops_payload()

        configured = next(row for row in payload["configured_agents"] if row["name"] == "claude")
        registered = next(row for row in payload["registered_agents"] if row["name"] == "claude")
        self.assertEqual(payload["project"]["tmux_prefix"], "agentchattr-agentchattr")
        self.assertEqual(configured["tmux"]["live_session"], "agentchattr-claude")
        self.assertEqual(configured["attach"]["live"], "tmux attach -t agentchattr-claude")
        self.assertEqual(configured["attach"]["wrapper"], "")
        self.assertEqual(registered["tmux"]["live_session"], "agentchattr-claude")

    def test_agent_ops_registered_attach_uses_original_tmux_slot_after_rename(self):
        app.config = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {
                "builder": {"provider": "codex", "label": "Builder", "color": "#10a37f"},
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registry.register("builder")
            registry.rename("builder", "agentchattr-builder")
            app.registry = registry
            app.agents = AgentTrigger(registry, data_dir=tmp)

            with mock.patch.object(app, "_tmux_sessions", return_value={"agentchattr-demo-builder"}):
                payload = app._agent_ops_payload()

        row = next(row for row in payload["registered_agents"] if row["name"] == "agentchattr-builder")
        self.assertEqual(row["tmux"]["live_session"], "agentchattr-demo-builder")
        self.assertEqual(row["attach"]["live"], "tmux attach -t agentchattr-demo-builder")

    def test_agent_ops_registered_attach_uses_slot_for_multiple_instances(self):
        app.config = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390, "host": "127.0.0.1", "data_dir": "./data/demo"},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "images": {"upload_dir": "./uploads/demo"},
            "agents": {
                "builder": {"provider": "codex", "label": "Builder", "color": "#10a37f"},
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            registry = RuntimeRegistry(data_dir=tmp)
            registry.seed(app.config["agents"])
            registry.register("builder")
            registry.register("builder")
            app.registry = registry
            app.agents = AgentTrigger(registry, data_dir=tmp)

            with mock.patch.object(app, "_tmux_sessions", return_value={
                "agentchattr-demo-builder",
                "agentchattr-demo-builder-2",
            }):
                payload = app._agent_ops_payload()

        rows = {row["name"]: row for row in payload["registered_agents"]}
        self.assertEqual(rows["builder-1"]["tmux"]["live_session"], "agentchattr-demo-builder")
        self.assertEqual(rows["builder-2"]["tmux"]["live_session"], "agentchattr-demo-builder-2")
        self.assertTrue(rows["builder-2"]["tmux"]["live_running"])

    def test_tmux_agent_session_preserves_base_name_and_warns_on_bad_slot(self):
        self.assertEqual(app._tmux_agent_session("prefix", "Builder Name"), "prefix-Builder Name")
        self.assertEqual(
            app._tmux_agent_session("agentchattr", "agentchattr-claude", sessions={"agentchattr-claude"}),
            "agentchattr-claude",
        )
        with self.assertLogs(app.log, level="WARNING") as captured:
            session = app._tmux_agent_session("prefix", "builder", "bad")

        self.assertEqual(session, "prefix-builder")
        self.assertIn("invalid slot 'bad' for agent base='builder'", captured.output[0])


if __name__ == "__main__":
    unittest.main()
