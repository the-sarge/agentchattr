import importlib.util
import importlib.machinery
import io
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load_ac():
    loader = importlib.machinery.SourceFileLoader("ac_runner", str(ROOT / "ac.py"))
    spec = importlib.util.spec_from_loader("ac_runner", loader)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RunnerCommandTests(unittest.TestCase):
    def setUp(self):
        self.ac = load_ac()

    def write_team(self, root: Path, name: str = "demo") -> Path:
        path = root / f"{name}.toml"
        path.write_text(
            """
[project]
name = "demo"
tmux_prefix = "agentchattr-demo"

[server]
port = 8390
data_dir = "./data/demo"

[mcp]
http_port = 8290
sse_port = 8291

[images]
upload_dir = "./uploads/demo"

[agents.builder]
command = "python"
color = "#10a37f"
args = ["--quiet"]
""".strip(),
            "utf-8",
        )
        return path

    def test_dry_run_prints_sessions_ports_paths_and_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            team = self.write_team(Path(tmp))
            args = types.SimpleNamespace(project="demo", file=str(team), dry_run=True)
            buf = io.StringIO()

            with mock.patch.object(self.ac, "validate_known_team_files"), redirect_stdout(buf):
                self.ac.up(args)

        out = buf.getvalue()
        self.assertIn("Team file:", out)
        self.assertIn("http://127.0.0.1:8390", out)
        self.assertIn("MCP HTTP: http://127.0.0.1:8290/mcp", out)
        self.assertIn("Data dir: ./data/demo", out)
        self.assertIn("Server log:", out)
        self.assertIn("agentchattr-demo-wrap-builder", out)
        self.assertIn("2>&1 | tee -a", out)
        self.assertIn("uv run --project", out)
        self.assertNotIn(".venv", out)
        self.assertIn("wrapper.py builder --detach --tmux-prefix agentchattr-demo", out)

    def test_start_tmux_session_wraps_tmux_not_found(self):
        with mock.patch.object(self.ac.subprocess, "check_call", side_effect=FileNotFoundError()):
            with self.assertRaises(SystemExit) as ctx:
                self.ac._start_tmux_session("demo", "echo hi")

        self.assertEqual(str(ctx.exception), "tmux executable not found on PATH; install tmux and retry.")

    def test_start_tmux_session_wraps_tmux_command_failure(self):
        error = subprocess.CalledProcessError(2, ["tmux"])

        with mock.patch.object(self.ac.subprocess, "check_call", side_effect=error):
            with self.assertRaises(SystemExit) as ctx:
                self.ac._start_tmux_session("demo", "echo hi")

        msg = str(ctx.exception)
        self.assertIn("Failed to start tmux session demo (exit 2)", msg)
        self.assertIn("Command: echo hi", msg)

    def test_logs_resolves_wrapper_target_and_lines(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml", target="wrapper:builder", lines=50)
        team = {"project": {"name": "demo", "tmux_prefix": "agentchattr-demo"}, "server": {"port": 8390}, "agents": {"builder": {"command": "python"}}}
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            return types.SimpleNamespace(returncode=0, stdout="line\n", stderr="")

        with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder"])), \
                mock.patch.object(self.ac, "_check_tmux"), \
                mock.patch.object(self.ac, "_tmux_session_exists", return_value=True), \
                mock.patch.object(self.ac.subprocess, "run", side_effect=fake_run):
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.ac.logs(args)

        self.assertEqual(calls[0], ["tmux", "capture-pane", "-p", "-t", "agentchattr-demo-wrap-builder", "-S", "-50"])
        self.assertEqual(buf.getvalue().strip(), "line")

    def test_logs_server_reads_persisted_log_without_tmux(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml", target="server", lines=2)
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "server.log"
            log_path.write_text("one\ntwo\nthree\n", "utf-8")
            team = {
                "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
                "server": {"port": 8390, "data_dir": tmp},
                "agents": {"builder": {"command": "python"}},
            }

            with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder"])), \
                    mock.patch.object(self.ac, "_check_tmux") as check_tmux:
                buf = io.StringIO()
                with redirect_stdout(buf):
                    self.ac.logs(args)

        check_tmux.assert_not_called()
        self.assertEqual(buf.getvalue().strip(), "two\nthree")

    def test_logs_server_reports_empty_persisted_log(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml", target="server", lines=2)
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "server.log"
            log_path.write_text("", "utf-8")
            team = {
                "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
                "server": {"port": 8390, "data_dir": tmp},
                "agents": {"builder": {"command": "python"}},
            }

            with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder"])), \
                    mock.patch.object(self.ac, "_check_tmux") as check_tmux:
                buf = io.StringIO()
                with redirect_stdout(buf):
                    self.ac.logs(args)

        check_tmux.assert_not_called()
        self.assertIn("(server log is empty:", buf.getvalue())

    def test_logs_missing_live_agent_hints_at_wrapper_logs(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml", target="builder", lines=50)
        team = {"project": {"name": "demo", "tmux_prefix": "agentchattr-demo"}, "server": {"port": 8390}, "agents": {"builder": {"command": "python"}}}

        def session_exists(session):
            return session == "agentchattr-demo-wrap-builder"

        with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder"])), \
                mock.patch.object(self.ac, "_check_tmux"), \
                mock.patch.object(self.ac, "_tmux_session_exists", side_effect=session_exists):
            with self.assertRaises(SystemExit) as ctx:
                self.ac.logs(args)

        msg = str(ctx.exception)
        self.assertIn("tmux session not found: agentchattr-demo-builder", msg)
        self.assertIn("./ac demo logs wrapper:builder", msg)

    def test_restart_targets_only_requested_agent_sessions(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml", target="builder")
        team = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "agents": {
                "builder": {"command": "python"},
                "reviewer": {"command": "python"},
            },
        }
        killed = []
        started = []

        with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder", "reviewer"])), \
                mock.patch.object(self.ac, "_check_tmux"), \
                mock.patch.object(self.ac, "_preflight_project"), \
                mock.patch.object(self.ac, "_port_open", return_value=True), \
                mock.patch.object(self.ac, "_tmux_session_exists", return_value=True), \
                mock.patch.object(self.ac, "_kill_tmux_session", side_effect=killed.append), \
                mock.patch.object(self.ac, "_check_uv"), \
                mock.patch.object(self.ac, "_start_wrapper", side_effect=lambda *a: started.append(a)):
            self.ac.restart(args)

        self.assertEqual(killed, ["agentchattr-demo-builder", "agentchattr-demo-wrap-builder"])
        self.assertEqual(len(started), 1)
        self.assertEqual(started[0][3], "builder")

    def test_check_project_runs_full_preflight_and_prints_summary(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml")
        team = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "agents": {"builder": {"command": "python"}},
        }
        buf = io.StringIO()

        with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder"])), \
                mock.patch.object(self.ac, "_preflight_project") as preflight, \
                mock.patch.object(self.ac, "_tmux_session_exists", return_value=False), \
                redirect_stdout(buf):
            self.ac.check_project(args)

        preflight.assert_called_once_with(team, "agentchattr-demo", require_tmux=True, check_ports=True, check_commands=True)
        out = buf.getvalue()
        self.assertIn("demo preflight OK", out)
        self.assertIn("Ports: web=8390, mcp_http=8290, mcp_sse=8291", out)
        self.assertIn("Agents: builder", out)

    def test_check_project_notes_running_server_when_ports_were_not_rechecked(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml")
        team = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "agents": {"builder": {"command": "python"}},
        }
        buf = io.StringIO()

        with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder"])), \
                mock.patch.object(self.ac, "_preflight_project"), \
                mock.patch.object(self.ac.shutil, "which", return_value="/usr/bin/tmux"), \
                mock.patch.object(self.ac, "_tmux_session_exists", return_value=True), \
                redirect_stdout(buf):
            self.ac.check_project(args)

        self.assertIn("preflight OK (server already running; ports not re-checked)", buf.getvalue())

    def test_preflight_reports_bad_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_file = root / "data-file"
            data_file.write_text("not a directory", "utf-8")
            team = {
                "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
                "server": {"port": 8390, "data_dir": str(data_file)},
                "mcp": {"http_port": 8290, "sse_port": 8291},
                "images": {"upload_dir": str(root / "uploads")},
                "agents": {"builder": {"command": "python", "cwd": str(root / "missing")}},
            }

            with mock.patch.object(self.ac, "validate_known_team_files"):
                with self.assertRaises(SystemExit) as ctx:
                    self.ac._preflight_project(
                        team,
                        "agentchattr-demo",
                        require_tmux=False,
                        check_ports=False,
                        check_commands=False,
                    )

        msg = str(ctx.exception)
        self.assertIn("server.data_dir points to a file", msg)
        self.assertIn("builder: cwd does not exist", msg)

    def test_server_start_failure_points_to_logs(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml", dry_run=False)
        team = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"port": 8390},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "agents": {"builder": {"command": "python"}},
        }

        with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder"])), \
                mock.patch.object(self.ac, "_preflight_project"), \
                mock.patch.object(self.ac, "_check_uv"), \
                mock.patch.object(self.ac, "_tmux_session_exists", return_value=False), \
                mock.patch.object(self.ac, "_start_tmux_session"), \
                mock.patch.object(self.ac, "_wait_for_port", return_value=False):
            with self.assertRaises(SystemExit) as ctx:
                self.ac.up(args)

        msg = str(ctx.exception)
        self.assertIn("Server did not start on port 8390 within 30s", msg)
        self.assertIn("Inspect server log:", msg)
        self.assertIn("server.log", msg)
        self.assertIn("If the tmux session is still present: ./ac demo logs server --lines 120", msg)

    def test_status_reports_service_agent_and_warning_states(self):
        args = types.SimpleNamespace(project="demo", file="/tmp/demo.toml")
        team = {
            "project": {"name": "demo", "tmux_prefix": "agentchattr-demo"},
            "server": {"host": "127.0.0.1", "port": 8390},
            "mcp": {"http_port": 8290, "sse_port": 8291},
            "agents": {
                "builder": {"command": "python"},
                "reviewer": {"command": "python"},
            },
        }
        sessions = [
            "agentchattr-demo-server",
            "agentchattr-demo-wrap-builder",
            "agentchattr-demo-reviewer",
            "agentchattr-demo-old-agent",
        ]

        def port_open(_host, port):
            return int(port) in {8390, 8291}

        with mock.patch.object(self.ac, "_project_context", return_value=(Path("/tmp/demo.toml"), team, "demo", "agentchattr-demo", 8390, ["builder", "reviewer"])), \
                mock.patch.object(self.ac, "_check_tmux"), \
                mock.patch.object(self.ac, "_tmux_sessions", return_value=sessions), \
                mock.patch.object(self.ac, "_host_port_open", side_effect=port_open):
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.ac.status(args)

        out = buf.getvalue()
        self.assertIn("Services:", out)
        self.assertIn("Server     running", out)
        self.assertIn("MCP HTTP   closed", out)
        self.assertIn("MCP SSE    listening", out)
        self.assertIn("builder          wrapper only", out)
        self.assertIn("reviewer         live only", out)
        self.assertIn("running but not configured: agentchattr-demo-old-agent", out)
        self.assertIn("builder: wrapper running without live agent session", out)
        self.assertIn("reviewer: live agent session running without wrapper supervisor", out)


if __name__ == "__main__":
    unittest.main()
