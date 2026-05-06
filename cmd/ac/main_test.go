package main

import (
	"path/filepath"
	"reflect"
	"testing"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestProjectContextLoadsTeamAndAppliesProviderDefaults(t *testing.T) {
	root := repoRoot(t)
	ctx, err := projectContext(root, options{file: filepath.Join(root, "teams/two-agent.toml.example")}, "two-agent")
	if err != nil {
		t.Fatal(err)
	}

	if ctx.name != "two-agent" {
		t.Fatalf("name = %q", ctx.name)
	}
	if ctx.prefix != "agentchattr-two-agent" {
		t.Fatalf("prefix = %q", ctx.prefix)
	}
	if ctx.port != 8310 {
		t.Fatalf("port = %d", ctx.port)
	}
	if !reflect.DeepEqual(ctx.agents, []string{"architect", "builder"}) {
		t.Fatalf("agents = %#v", ctx.agents)
	}
	if got := ctx.team.Agents["architect"].Command; got != "claude" {
		t.Fatalf("architect command = %q", got)
	}
	if got := ctx.team.Agents["builder"].Command; got != "codex" {
		t.Fatalf("builder command = %q", got)
	}
}

func TestWrapperCmdArgsSelectsAPIWrapper(t *testing.T) {
	team := Config{
		Agents: map[string]AgentConfig{
			"local-qwen": {Type: "api"},
			"builder":    {Provider: "codex", Command: "codex"},
		},
	}

	api := wrapperCmdArgs("/repo", team, "local-qwen", "agentchattr-demo")
	if !reflect.DeepEqual(api, []string{"uv", "run", "--project", "/repo", "python", "wrapper_api.py", "local-qwen"}) {
		t.Fatalf("api wrapper args = %#v", api)
	}

	cli := wrapperCmdArgs("/repo", team, "builder", "agentchattr-demo")
	want := []string{"uv", "run", "--project", "/repo", "python", "wrapper.py", "builder", "--detach", "--tmux-prefix", "agentchattr-demo"}
	if !reflect.DeepEqual(cli, want) {
		t.Fatalf("cli wrapper args = %#v", cli)
	}
}

func TestResolveTargetSession(t *testing.T) {
	agents := []string{"architect", "builder"}
	cases := map[string]string{
		"server":            "agentchattr-demo-server",
		"builder":           "agentchattr-demo-builder",
		"wrapper:builder":   "agentchattr-demo-wrap-builder",
		"wrap:architect":    "agentchattr-demo-wrap-architect",
		"raw-session-name":  "raw-session-name",
		"wrapper:Build Bot": "agentchattr-demo-wrap-Build-Bot",
	}
	for target, want := range cases {
		if got := resolveTargetSession("agentchattr-demo", agents, target); got != want {
			t.Fatalf("resolveTargetSession(%q) = %q, want %q", target, got, want)
		}
	}
}

func TestShellCommandQuotesEnvironmentAndArgs(t *testing.T) {
	env := envForProject("/tmp/team file.toml", "agentchattr-demo")
	args := []string{"uv", "run", "--project", "/tmp/repo root", "python", "run.py"}
	got := shellCommand(env, args)
	want := "env AGENTCHATTR_PROJECT_CONFIG='/tmp/team file.toml' AGENTCHATTR_TMUX_PREFIX=agentchattr-demo uv run --project '/tmp/repo root' python run.py"
	if got != want {
		t.Fatalf("shellCommand = %q, want %q", got, want)
	}
}
