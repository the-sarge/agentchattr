import importlib.util
import importlib.machinery
import io
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load_ac():
    loader = importlib.machinery.SourceFileLoader("ac_runner", str(ROOT / "ac"))
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
        self.assertIn("agentchattr-demo-wrap-builder", out)
        self.assertIn("wrapper.py builder --detach --tmux-prefix agentchattr-demo", out)

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
                mock.patch.object(self.ac, "_ensure_venv", return_value=Path("/venv/bin/python")), \
                mock.patch.object(self.ac, "_start_wrapper", side_effect=lambda *a: started.append(a)):
            self.ac.restart(args)

        self.assertEqual(killed, ["agentchattr-demo-builder", "agentchattr-demo-wrap-builder"])
        self.assertEqual(len(started), 1)
        self.assertEqual(started[0][3], "builder")


if __name__ == "__main__":
    unittest.main()
