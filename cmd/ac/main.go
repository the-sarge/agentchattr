package main

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/spf13/cobra"
)

type ProjectConfig struct {
	Name       string `toml:"name"`
	Title      string `toml:"title"`
	TmuxPrefix string `toml:"tmux_prefix"`
}

type ServerConfig struct {
	Host    string `toml:"host"`
	Port    int    `toml:"port"`
	DataDir string `toml:"data_dir"`
}

type MCPConfig struct {
	Host     string `toml:"host"`
	HTTPPort int    `toml:"http_port"`
	SSEPort  int    `toml:"sse_port"`
}

type ImagesConfig struct {
	UploadDir string `toml:"upload_dir"`
}

type AgentConfig struct {
	Provider string   `toml:"provider"`
	Command  string   `toml:"command"`
	Type     string   `toml:"type"`
	Cwd      string   `toml:"cwd"`
	Label    string   `toml:"label"`
	Role     string   `toml:"role"`
	Team     string   `toml:"team"`
	Color    string   `toml:"color"`
	Args     []string `toml:"args"`
}

type Config struct {
	Project       ProjectConfig          `toml:"project"`
	Server        ServerConfig           `toml:"server"`
	MCP           MCPConfig              `toml:"mcp"`
	Images        ImagesConfig           `toml:"images"`
	Agents        map[string]AgentConfig `toml:"agents"`
	AgentDefaults map[string]AgentConfig `toml:"agent_defaults"`
	AgentOrder    []string               `toml:"-"`
	TeamFile      string                 `toml:"-"`
}

type context struct {
	root     string
	teamFile string
	team     Config
	name     string
	prefix   string
	port     int
	agents   []string
}

type options struct {
	file   string
	dryRun bool
	lines  int
}

var providerCommands = map[string]string{
	"claude":    "claude",
	"codex":     "codex",
	"gemini":    "gemini",
	"kimi":      "kimi",
	"qwen":      "qwen",
	"kilo":      "kilo",
	"codebuddy": "codebuddy",
	"copilot":   "copilot",
}

var slugPattern = regexp.MustCompile(`[^a-zA-Z0-9_.-]+`)

func main() {
	var opts options
	rootCmd := &cobra.Command{
		Use:           "ac [project|list] [up|down|status|attach|restart|logs|check] [target]",
		Short:         "Start/stop project-specific agentchattr teams.",
		SilenceUsage:  true,
		SilenceErrors: true,
		Args:          cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			root, err := findRepoRoot()
			if err != nil {
				return err
			}
			return dispatch(root, opts, args)
		},
	}
	rootCmd.Flags().StringVarP(&opts.file, "file", "f", "", "Explicit team TOML file")
	rootCmd.Flags().BoolVar(&opts.dryRun, "dry-run", false, "For up: print sessions, ports, paths, and commands without starting anything")
	rootCmd.Flags().IntVar(&opts.lines, "lines", 200, "For logs: number of pane lines to capture")

	if err := rootCmd.Execute(); err != nil {
		var exitErr exitError
		if errors.As(err, &exitErr) {
			if exitErr.msg != "" {
				fmt.Fprintln(os.Stderr, exitErr.msg)
			}
			os.Exit(exitErr.code)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func dispatch(root string, opts options, args []string) error {
	if len(args) == 1 && args[0] == "list" {
		return listProjects(root)
	}
	if len(args) < 2 {
		return errors.New("usage: ac [project|list] [up|down|status|attach|restart|logs|check] [target]")
	}
	project, action := args[0], args[1]
	target := ""
	if len(args) > 2 {
		target = args[2]
	}

	switch action {
	case "up":
		return up(root, opts, project)
	case "check":
		return checkProject(root, opts, project)
	case "down":
		return down(root, opts, project)
	case "status":
		return status(root, opts, project)
	case "attach":
		return attach(root, opts, project, target)
	case "restart":
		return restart(root, opts, project, target)
	case "logs":
		return logs(root, opts, project, target)
	default:
		return fmt.Errorf("unknown action %q", action)
	}
}

func findRepoRoot() (string, error) {
	candidates := []string{}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd)
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Dir(exe))
	}
	for _, start := range candidates {
		dir, _ := filepath.Abs(start)
		for {
			if fileExists(filepath.Join(dir, "config.toml")) &&
				fileExists(filepath.Join(dir, "run.py")) &&
				fileExists(filepath.Join(dir, "pyproject.toml")) {
				return dir, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "", errors.New("agentchattr repo root not found")
}

func slug(value string) string {
	s := slugPattern.ReplaceAllString(strings.TrimSpace(value), "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "default"
	}
	return s
}

func findTeamFile(root, project, explicit string) (string, []string, error) {
	var candidates []string
	if explicit != "" {
		candidates = append(candidates, explicit)
	} else {
		raw := project
		if strings.HasSuffix(raw, ".toml") || fileExists(raw) {
			candidates = append(candidates, raw)
		}
		candidates = append(candidates,
			filepath.Join(root, "teams", project+".toml"),
			filepath.Join(root, "projects", project+".toml"),
			filepath.Join(root, project+".toml"),
		)
	}
	for _, candidate := range candidates {
		path := expandHome(candidate)
		if !filepath.IsAbs(path) {
			abs, _ := filepath.Abs(path)
			path = abs
		}
		if fileExists(path) {
			return path, candidates, nil
		}
	}
	return "", candidates, errors.New("team file not found")
}

func loadProjectConfig(root, teamFile string) (Config, error) {
	cfg, err := loadConfigFile(filepath.Join(root, "config.toml"))
	if err != nil {
		return Config{}, err
	}
	localPath := filepath.Join(root, "config.local.toml")
	if fileExists(localPath) {
		local, err := loadConfigFile(localPath)
		if err != nil {
			return Config{}, err
		}
		if cfg.Agents == nil {
			cfg.Agents = map[string]AgentConfig{}
		}
		for name, agent := range local.Agents {
			if _, exists := cfg.Agents[name]; !exists {
				cfg.Agents[name] = agent
				cfg.AgentOrder = appendIfMissing(cfg.AgentOrder, name)
			}
		}
	}
	if teamFile != "" {
		team, err := loadConfigFile(teamFile)
		if err != nil {
			return Config{}, err
		}
		cfg = mergeConfig(cfg, team)
		cfg.TeamFile = teamFile
	}
	applyAgentDefaults(&cfg)
	normalizeAgentDefaults(&cfg)
	setConfigDefaults(&cfg)
	if err := validateConfig(cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func loadConfigFile(path string) (Config, error) {
	var cfg Config
	meta, err := toml.DecodeFile(path, &cfg)
	if err != nil {
		return Config{}, err
	}
	if cfg.Agents == nil {
		cfg.Agents = map[string]AgentConfig{}
	}
	if cfg.AgentDefaults == nil {
		cfg.AgentDefaults = map[string]AgentConfig{}
	}
	cfg.AgentOrder = agentOrderFromMeta(meta)
	return cfg, nil
}

func mergeConfig(base, overlay Config) Config {
	if overlay.Project != (ProjectConfig{}) {
		base.Project = mergeProject(base.Project, overlay.Project)
	}
	base.Server = mergeServer(base.Server, overlay.Server)
	base.MCP = mergeMCP(base.MCP, overlay.MCP)
	base.Images = mergeImages(base.Images, overlay.Images)
	if len(overlay.AgentDefaults) > 0 {
		if base.AgentDefaults == nil {
			base.AgentDefaults = map[string]AgentConfig{}
		}
		for name, defaults := range overlay.AgentDefaults {
			base.AgentDefaults[name] = mergeAgent(base.AgentDefaults[name], defaults)
		}
	}
	if len(overlay.Agents) > 0 {
		base.Agents = overlay.Agents
		base.AgentOrder = overlay.AgentOrder
	}
	return base
}

func agentOrderFromMeta(meta toml.MetaData) []string {
	var order []string
	seen := map[string]bool{}
	for _, key := range meta.Keys() {
		if len(key) < 2 || key[0] != "agents" {
			continue
		}
		name := key[1]
		if !seen[name] {
			order = append(order, name)
			seen[name] = true
		}
	}
	return order
}

func mergeProject(base, overlay ProjectConfig) ProjectConfig {
	if overlay.Name != "" {
		base.Name = overlay.Name
	}
	if overlay.Title != "" {
		base.Title = overlay.Title
	}
	if overlay.TmuxPrefix != "" {
		base.TmuxPrefix = overlay.TmuxPrefix
	}
	return base
}

func mergeServer(base, overlay ServerConfig) ServerConfig {
	if overlay.Host != "" {
		base.Host = overlay.Host
	}
	if overlay.Port != 0 {
		base.Port = overlay.Port
	}
	if overlay.DataDir != "" {
		base.DataDir = overlay.DataDir
	}
	return base
}

func mergeMCP(base, overlay MCPConfig) MCPConfig {
	if overlay.Host != "" {
		base.Host = overlay.Host
	}
	if overlay.HTTPPort != 0 {
		base.HTTPPort = overlay.HTTPPort
	}
	if overlay.SSEPort != 0 {
		base.SSEPort = overlay.SSEPort
	}
	return base
}

func mergeImages(base, overlay ImagesConfig) ImagesConfig {
	if overlay.UploadDir != "" {
		base.UploadDir = overlay.UploadDir
	}
	return base
}

func mergeAgent(base, overlay AgentConfig) AgentConfig {
	if overlay.Provider != "" {
		base.Provider = overlay.Provider
	}
	if overlay.Command != "" {
		base.Command = overlay.Command
	}
	if overlay.Type != "" {
		base.Type = overlay.Type
	}
	if overlay.Cwd != "" {
		base.Cwd = overlay.Cwd
	}
	if overlay.Label != "" {
		base.Label = overlay.Label
	}
	if overlay.Role != "" {
		base.Role = overlay.Role
	}
	if overlay.Team != "" {
		base.Team = overlay.Team
	}
	if overlay.Color != "" {
		base.Color = overlay.Color
	}
	if overlay.Args != nil {
		base.Args = overlay.Args
	}
	return base
}

func applyAgentDefaults(cfg *Config) {
	for name, agent := range cfg.Agents {
		provider := strings.ToLower(strings.TrimSpace(agent.Provider))
		if provider == "" && strings.ToLower(strings.TrimSpace(agent.Type)) == "api" {
			provider = "api"
		}
		if provider == "" {
			continue
		}
		defaults, ok := cfg.AgentDefaults[provider]
		if !ok {
			continue
		}
		cfg.Agents[name] = mergeAgent(defaults, agent)
	}
}

func normalizeAgentDefaults(cfg *Config) {
	for name, agent := range cfg.Agents {
		provider := strings.ToLower(strings.TrimSpace(agent.Provider))
		if agent.Command == "" {
			if command, ok := providerCommands[provider]; ok {
				agent.Command = command
			}
		}
		cfg.Agents[name] = agent
	}
}

func setConfigDefaults(cfg *Config) {
	if cfg.Server.Host == "" {
		cfg.Server.Host = "127.0.0.1"
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8300
	}
	if cfg.Server.DataDir == "" {
		cfg.Server.DataDir = "./data"
	}
	if cfg.MCP.Host == "" {
		cfg.MCP.Host = "127.0.0.1"
	}
	if cfg.MCP.HTTPPort == 0 {
		cfg.MCP.HTTPPort = 8200
	}
	if cfg.MCP.SSEPort == 0 {
		cfg.MCP.SSEPort = 8201
	}
	if cfg.Images.UploadDir == "" {
		cfg.Images.UploadDir = "./uploads"
	}
}

func validateConfig(cfg Config) error {
	if len(cfg.Agents) == 0 {
		return errors.New("config must define at least one [agents.<name>] entry")
	}
	for label, port := range map[string]int{
		"[server].port":   cfg.Server.Port,
		"[mcp].http_port": cfg.MCP.HTTPPort,
		"[mcp].sse_port":  cfg.MCP.SSEPort,
	} {
		if port < 1 || port > 65535 {
			return fmt.Errorf("%s must be between 1 and 65535", label)
		}
	}
	return nil
}

func projectContext(root string, opts options, project string) (context, error) {
	teamFile, searched, err := findTeamFile(root, project, opts.file)
	if err != nil {
		return context{}, fmt.Errorf("Team file not found. Searched:\n  %s", strings.Join(searched, "\n  "))
	}
	team, err := loadProjectConfig(root, teamFile)
	if err != nil {
		return context{}, fmt.Errorf("Config error: %w", err)
	}
	name := team.Project.Name
	if name == "" {
		name = project
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(teamFile), filepath.Ext(teamFile))
	}
	prefix := team.Project.TmuxPrefix
	if prefix != "" {
		prefix = slug(prefix)
	} else {
		prefix = "agentchattr-" + slug(name)
	}
	agents := agentNames(team)
	if len(agents) == 0 {
		return context{}, errors.New("Team file must define at least one [agents.<name>] entry.")
	}
	return context{
		root:     root,
		teamFile: teamFile,
		team:     team,
		name:     name,
		prefix:   prefix,
		port:     team.Server.Port,
		agents:   agents,
	}, nil
}

func agentNames(team Config) []string {
	names := make([]string, 0, len(team.Agents))
	seen := map[string]bool{}
	for _, name := range team.AgentOrder {
		if _, ok := team.Agents[name]; ok && !seen[name] {
			names = append(names, name)
			seen[name] = true
		}
	}
	var remaining []string
	for name := range team.Agents {
		if !seen[name] {
			remaining = append(remaining, name)
		}
	}
	sort.Strings(remaining)
	names = append(names, remaining...)
	return names
}

func isAPIAgent(team Config, agent string) bool {
	return strings.EqualFold(strings.TrimSpace(team.Agents[agent].Type), "api")
}

func uvPythonCmd(root string) []string {
	return []string{"uv", "run", "--project", root, "python"}
}

func pythonScriptCmdArgs(root, script string, args ...string) []string {
	cmd := append([]string{}, uvPythonCmd(root)...)
	cmd = append(cmd, script)
	cmd = append(cmd, args...)
	return cmd
}

func wrapperScript(team Config, agent string) string {
	if isAPIAgent(team, agent) {
		return "wrapper_api.py"
	}
	return "wrapper.py"
}

func wrapperCmdArgs(root string, team Config, agent, prefix string) []string {
	script := wrapperScript(team, agent)
	cmd := pythonScriptCmdArgs(root, script, agent)
	if script == "wrapper.py" {
		cmd = append(cmd, "--detach", "--tmux-prefix", prefix)
	}
	return cmd
}

func envForProject(teamFile, prefix string) map[string]string {
	return map[string]string{
		"AGENTCHATTR_PROJECT_CONFIG": teamFile,
		"AGENTCHATTR_TMUX_PREFIX":    prefix,
	}
}

func shellCommand(env map[string]string, args []string) string {
	keys := []string{"AGENTCHATTR_PROJECT_CONFIG", "AGENTCHATTR_TMUX_PREFIX"}
	parts := []string{"env"}
	for _, key := range keys {
		if value, ok := env[key]; ok {
			parts = append(parts, key+"="+shQuote(value))
		}
	}
	for _, arg := range args {
		parts = append(parts, shQuote(arg))
	}
	return strings.Join(parts, " ")
}

func commandWithServerLog(command, logPath string) string {
	return fmt.Sprintf("%s 2>&1 | tee -a %s", command, shQuote(logPath))
}

func agentSessions(prefix, agent string) (string, string) {
	return prefix + "-" + agent, prefix + "-wrap-" + slug(agent)
}

func resolveTargetSession(prefix string, agents []string, target string) string {
	target = strings.TrimSpace(target)
	if target == "server" {
		return prefix + "-server"
	}
	if strings.HasPrefix(target, "wrapper:") || strings.HasPrefix(target, "wrap:") {
		parts := strings.SplitN(target, ":", 2)
		return prefix + "-wrap-" + slug(parts[1])
	}
	if contains(agents, target) {
		return prefix + "-" + target
	}
	return target
}

func preflightProject(root string, ctx context, requireTmux, checkPorts, checkCommands bool) error {
	var errs []string
	if requireTmux && !commandExists("tmux") {
		errs = append(errs, "tmux is required. Install it first, then retry.")
	}
	if err := validateKnownTeamFiles(root); err != nil {
		errs = append(errs, err.Error())
	}
	if checkCommands {
		for _, agent := range ctx.agents {
			if missing := commandMissing(root, ctx.team, agent); missing != "" {
				errs = append(errs, missing)
			}
		}
	}
	errs = append(errs, pathPreflightErrors(root, ctx.team)...)
	if checkPorts {
		serverSession := ctx.prefix + "-server"
		serverAlreadyRunning := commandExists("tmux") && tmuxSessionExists(serverSession)
		if !serverAlreadyRunning {
			for _, item := range []struct {
				label string
				port  int
			}{
				{"server", ctx.team.Server.Port},
				{"MCP HTTP", ctx.team.MCP.HTTPPort},
				{"MCP SSE", ctx.team.MCP.SSEPort},
			} {
				if hostPortOpen("127.0.0.1", item.port) {
					errs = append(errs, fmt.Sprintf("%s port %d is already in use", item.label, item.port))
				}
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("Preflight failed:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return nil
}

func validateKnownTeamFiles(root string) error {
	paths := discoverTeamFiles(root)
	prefixes := map[string]string{}
	ports := map[int]string{}
	var errs []string
	for _, path := range paths {
		cfg, err := loadProjectConfig(root, path)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", path, err))
			continue
		}
		name := cfg.Project.Name
		if name == "" {
			name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		}
		prefix := cfg.Project.TmuxPrefix
		if prefix == "" {
			prefix = "agentchattr-" + slug(name)
		}
		if existing, ok := prefixes[prefix]; ok {
			errs = append(errs, fmt.Sprintf("%s: duplicate tmux_prefix %s; already used by %s", path, prefix, existing))
		} else {
			prefixes[prefix] = path
		}
		for label, port := range map[string]int{
			"[server].port":   cfg.Server.Port,
			"[mcp].http_port": cfg.MCP.HTTPPort,
			"[mcp].sse_port":  cfg.MCP.SSEPort,
		} {
			if existing, ok := ports[port]; ok {
				errs = append(errs, fmt.Sprintf("%s: duplicate port %d for %s; already used by %s", path, port, label, existing))
			} else {
				ports[port] = path
			}
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "\n  - "))
	}
	return nil
}

func discoverTeamFiles(root string) []string {
	var paths []string
	for _, dirname := range []string{"teams", "projects"} {
		matches, _ := filepath.Glob(filepath.Join(root, dirname, "*.toml"))
		paths = append(paths, matches...)
	}
	sort.Strings(paths)
	return paths
}

func pathPreflightErrors(root string, team Config) []string {
	var errs []string
	for _, item := range []struct {
		label string
		raw   string
	}{
		{"server.data_dir", team.Server.DataDir},
		{"images.upload_dir", team.Images.UploadDir},
	} {
		path := resolveProjectPath(root, item.raw)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			errs = append(errs, fmt.Sprintf("%s points to a file, not a directory: %s", item.label, path))
		}
	}
	for _, agent := range agentNames(team) {
		if isAPIAgent(team, agent) {
			continue
		}
		cwd := strings.TrimSpace(team.Agents[agent].Cwd)
		if cwd == "" {
			errs = append(errs, fmt.Sprintf("%s: cwd must be a non-empty string", agent))
			continue
		}
		path := resolveProjectPath(root, cwd)
		info, err := os.Stat(path)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: cwd does not exist: %s", agent, path))
		} else if !info.IsDir() {
			errs = append(errs, fmt.Sprintf("%s: cwd is not a directory: %s", agent, path))
		}
	}
	return errs
}

func commandMissing(root string, team Config, agent string) string {
	if isAPIAgent(team, agent) {
		return ""
	}
	command := strings.TrimSpace(team.Agents[agent].Command)
	if command == "" {
		return fmt.Sprintf("%s: missing command", agent)
	}
	if strings.ContainsRune(command, os.PathSeparator) {
		path := expandHome(command)
		if !filepath.IsAbs(path) {
			path = resolveProjectPath(root, path)
		}
		if info, err := os.Stat(path); err == nil && !info.IsDir() && isExecutable(info) {
			return ""
		}
	} else if commandExists(command) {
		return ""
	}
	return fmt.Sprintf("%s: command not found on PATH: %s", agent, command)
}

func printDryRun(ctx context) {
	env := envForProject(ctx.teamFile, ctx.prefix)
	fmt.Printf("%s dry run\n", ctx.name)
	fmt.Printf("Team file: %s\n", ctx.teamFile)
	fmt.Printf("Web UI: http://127.0.0.1:%d\n", ctx.port)
	fmt.Printf("MCP HTTP: http://127.0.0.1:%d/mcp\n", ctx.team.MCP.HTTPPort)
	fmt.Printf("MCP SSE: http://127.0.0.1:%d/sse\n", ctx.team.MCP.SSEPort)
	fmt.Printf("Data dir: %s\n", ctx.team.Server.DataDir)
	fmt.Printf("Upload dir: %s\n", ctx.team.Images.UploadDir)
	fmt.Printf("Server log: %s\n", serverLogPath(ctx.root, ctx.team))
	fmt.Printf("Tmux prefix: %s\n", ctx.prefix)
	fmt.Println("Tmux sessions:")
	fmt.Printf("  server            %s-server\n", ctx.prefix)
	for _, agent := range ctx.agents {
		live, wrapper := agentSessions(ctx.prefix, agent)
		fmt.Printf("  %-16s %s\n", agent, live)
		fmt.Printf("  %-16s %s\n", "wrapper:"+agent, wrapper)
	}
	fmt.Println("Commands:")
	serverCommand := commandWithServerLog(shellCommand(env, pythonScriptCmdArgs(ctx.root, "run.py")), serverLogPath(ctx.root, ctx.team))
	fmt.Printf("  server            %s\n", serverCommand)
	for _, agent := range ctx.agents {
		fmt.Printf("  %-16s %s\n", agent, shellCommand(env, wrapperCmdArgs(ctx.root, ctx.team, agent, ctx.prefix)))
	}
}

func up(root string, opts options, project string) error {
	ctx, err := projectContext(root, opts, project)
	if err != nil {
		return err
	}
	if err := preflightProject(root, ctx, !opts.dryRun, !opts.dryRun, !opts.dryRun); err != nil {
		return err
	}
	if opts.dryRun {
		printDryRun(ctx)
		return nil
	}
	if !commandExists("uv") {
		return errors.New("uv is required. Install it first, then retry:\n  https://docs.astral.sh/uv/getting-started/installation/")
	}
	env := envForProject(ctx.teamFile, ctx.prefix)
	serverSession := ctx.prefix + "-server"
	if tmuxSessionExists(serverSession) {
		fmt.Printf("Server already running: %s\n", serverSession)
	} else {
		logPath := serverLogPath(root, ctx.team)
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
			return fmt.Errorf("Unable to create server log directory %s: %w", filepath.Dir(logPath), err)
		}
		command := commandWithServerLog(shellCommand(env, pythonScriptCmdArgs(root, "run.py")), logPath)
		if err := startTmuxSession(root, serverSession, command); err != nil {
			return err
		}
		fmt.Printf("Started server: %s\n", serverSession)
		if !waitForPort(ctx.port, 30*time.Second) {
			return fmt.Errorf("Server did not start on port %d within 30s.\nInspect server log: %s\nIf the tmux session is still present: ./ac %s logs server --lines 120\nAttach directly if still present: tmux attach -t %s", ctx.port, logPath, project, serverSession)
		}
	}
	for _, agent := range ctx.agents {
		_, wrapper := agentSessions(ctx.prefix, agent)
		if tmuxSessionExists(wrapper) {
			fmt.Printf("Agent wrapper already running: %s\n", wrapper)
			continue
		}
		if err := startWrapper(ctx, agent); err != nil {
			return err
		}
		fmt.Printf("Started %s: wrapper=%s, agent=%s-%s\n", agent, wrapper, ctx.prefix, agent)
	}
	fmt.Printf("\n%s is up: http://127.0.0.1:%d\n", ctx.name, ctx.port)
	fmt.Printf("Team file: %s\n", ctx.teamFile)
	fmt.Printf("Sessions: tmux list-sessions | grep %s\n", shQuote(ctx.prefix))
	return nil
}

func checkProject(root string, opts options, project string) error {
	ctx, err := projectContext(root, opts, project)
	if err != nil {
		return err
	}
	if err := preflightProject(root, ctx, true, true, true); err != nil {
		return err
	}
	serverSession := ctx.prefix + "-server"
	if commandExists("tmux") && tmuxSessionExists(serverSession) {
		fmt.Printf("%s preflight OK (server already running; ports not re-checked)\n", ctx.name)
	} else {
		fmt.Printf("%s preflight OK\n", ctx.name)
	}
	fmt.Printf("Team file: %s\n", ctx.teamFile)
	fmt.Printf("Tmux prefix: %s\n", ctx.prefix)
	fmt.Printf("Ports: web=%d, mcp_http=%d, mcp_sse=%d\n", ctx.port, ctx.team.MCP.HTTPPort, ctx.team.MCP.SSEPort)
	fmt.Printf("Agents: %s\n", strings.Join(ctx.agents, ", "))
	return nil
}

func down(root string, opts options, project string) error {
	if !commandExists("tmux") {
		return errors.New("tmux is required. Install it first, then retry.")
	}
	ctx, err := projectContext(root, opts, project)
	if err != nil {
		return err
	}
	matches := []string{}
	for _, session := range tmuxSessions() {
		if session == ctx.prefix || strings.HasPrefix(session, ctx.prefix+"-") {
			matches = append(matches, session)
		}
	}
	if len(matches) == 0 {
		fmt.Printf("No tmux sessions found for %s (%s).\n", ctx.name, ctx.prefix)
		return nil
	}
	sort.Sort(sort.Reverse(sort.StringSlice(matches)))
	for _, session := range matches {
		killTmuxSession(session)
		fmt.Printf("Stopped %s\n", session)
	}
	return nil
}

func restart(root string, opts options, project, target string) error {
	if !commandExists("tmux") {
		return errors.New("tmux is required. Install it first, then retry.")
	}
	ctx, err := projectContext(root, opts, project)
	if err != nil {
		return err
	}
	target = strings.TrimSpace(target)
	if !contains(ctx.agents, target) {
		fmt.Printf("Unknown agent: %s\n\n", missingLabel(target))
		printAttachHelp(ctx.prefix, ctx.agents)
		return errExit(2)
	}
	if err := preflightProject(root, ctx, true, false, true); err != nil {
		return err
	}
	if !hostPortOpen("127.0.0.1", ctx.port) {
		return fmt.Errorf("Server is not listening on port %d; start the project before restarting an agent.", ctx.port)
	}
	live, wrapper := agentSessions(ctx.prefix, target)
	for _, session := range []string{live, wrapper} {
		if tmuxSessionExists(session) {
			killTmuxSession(session)
			fmt.Printf("Stopped %s\n", session)
		}
	}
	if !commandExists("uv") {
		return errors.New("uv is required. Install it first, then retry:\n  https://docs.astral.sh/uv/getting-started/installation/")
	}
	if err := startWrapper(ctx, target); err != nil {
		return err
	}
	fmt.Printf("Restarted %s: wrapper=%s, agent=%s\n", target, wrapper, live)
	return nil
}

func logs(root string, opts options, project, target string) error {
	ctx, err := projectContext(root, opts, project)
	if err != nil {
		return err
	}
	target = strings.TrimSpace(target)
	if target == "" {
		return errExitMsg(2, "logs requires a target: server, <agent>, wrapper:<agent>, or raw tmux session")
	}
	lines := opts.lines
	if lines < 1 {
		lines = 1
	}
	if target == "server" {
		path := serverLogPath(root, ctx.team)
		if fileExists(path) {
			out, err := tailFile(path, lines)
			if err != nil {
				return err
			}
			if out != "" {
				fmt.Println(out)
			} else {
				fmt.Printf("(server log is empty: %s)\n", path)
			}
			return nil
		}
	}
	if !commandExists("tmux") {
		return errors.New("tmux is required. Install it first, then retry.")
	}
	session := resolveTargetSession(ctx.prefix, ctx.agents, target)
	if !tmuxSessionExists(session) {
		hint := ""
		if target == "server" {
			hint = "\nPersisted server log not found: " + serverLogPath(root, ctx.team)
		} else if contains(ctx.agents, target) {
			_, wrapper := agentSessions(ctx.prefix, target)
			if tmuxSessionExists(wrapper) {
				hint = fmt.Sprintf("\nLive session is missing, but wrapper is running. Try: ./ac %s logs wrapper:%s", project, target)
			}
		}
		return fmt.Errorf("tmux session not found: %s%s", session, hint)
	}
	out, err := exec.Command("tmux", "capture-pane", "-p", "-t", session, "-S", fmt.Sprintf("-%d", lines)).CombinedOutput()
	if err != nil {
		text := strings.TrimSpace(string(out))
		if text == "" {
			text = fmt.Sprintf("failed to capture logs from %s", session)
		}
		return errors.New(text)
	}
	fmt.Println(strings.TrimRight(string(out), "\n"))
	return nil
}

func status(root string, opts options, project string) error {
	if !commandExists("tmux") {
		return errors.New("tmux is required. Install it first, then retry.")
	}
	ctx, err := projectContext(root, opts, project)
	if err != nil {
		return err
	}
	sessions := []string{}
	for _, session := range tmuxSessions() {
		if session == ctx.prefix || strings.HasPrefix(session, ctx.prefix+"-") {
			sessions = append(sessions, session)
		}
	}
	sessionSet := map[string]bool{}
	for _, session := range sessions {
		sessionSet[session] = true
	}
	serverSession := ctx.prefix + "-server"
	serverListening := hostPortOpen(ctx.team.Server.Host, ctx.port)
	httpListening := hostPortOpen(ctx.team.MCP.Host, ctx.team.MCP.HTTPPort)
	sseListening := hostPortOpen(ctx.team.MCP.Host, ctx.team.MCP.SSEPort)
	fmt.Println(ctx.name)
	fmt.Printf("Team file: %s\n", ctx.teamFile)
	fmt.Printf("Tmux prefix: %s\n", ctx.prefix)
	fmt.Println("Services:")
	fmt.Printf("  %-10s %-11s %s:%-6d %s\n", "Server", serverState(sessionSet[serverSession], serverListening), probeHost(ctx.team.Server.Host), ctx.port, serverSession)
	fmt.Printf("  %-10s %-11s %s:%d\n", "MCP HTTP", listeningState(httpListening), probeHost(ctx.team.MCP.Host), ctx.team.MCP.HTTPPort)
	fmt.Printf("  %-10s %-11s %s:%d\n", "MCP SSE", listeningState(sseListening), probeHost(ctx.team.MCP.Host), ctx.team.MCP.SSEPort)
	fmt.Println("Agents:")
	warnings := []string{}
	expected := map[string]bool{serverSession: true}
	for _, agent := range ctx.agents {
		live, wrapper := agentSessions(ctx.prefix, agent)
		expected[live] = true
		expected[wrapper] = true
		liveRunning := sessionSet[live]
		wrapperRunning := sessionSet[wrapper]
		liveLabel := "live stopped"
		if liveRunning {
			liveLabel = "live running"
		}
		wrapperLabel := "wrapper stopped"
		if wrapperRunning {
			wrapperLabel = "wrapper running"
		}
		fmt.Printf("  %-16s %-12s live=%s (%s); wrapper=%s (%s)\n", agent, agentState(liveRunning, wrapperRunning), live, liveLabel, wrapper, wrapperLabel)
		if wrapperRunning && !liveRunning {
			warnings = append(warnings, fmt.Sprintf("%s: wrapper running without live agent session", agent))
		} else if liveRunning && !wrapperRunning {
			warnings = append(warnings, fmt.Sprintf("%s: live agent session running without wrapper supervisor", agent))
		}
	}
	extra := []string{}
	for _, session := range sessions {
		if !expected[session] {
			extra = append(extra, session)
		}
	}
	if len(extra) > 0 || len(warnings) > 0 {
		fmt.Println("Warnings:")
		for _, session := range extra {
			fmt.Printf("  running but not configured: %s\n", session)
		}
		for _, warning := range warnings {
			fmt.Printf("  %s\n", warning)
		}
	}
	fmt.Println()
	fmt.Printf("Attach: ./ac %s attach <agent>\n", project)
	return nil
}

func attach(root string, opts options, project, target string) error {
	if !commandExists("tmux") {
		return errors.New("tmux is required. Install it first, then retry.")
	}
	ctx, err := projectContext(root, opts, project)
	if err != nil {
		return err
	}
	target = strings.TrimSpace(target)
	if target == "" {
		fmt.Println(ctx.name)
		printAttachHelp(ctx.prefix, ctx.agents)
		return errExit(2)
	}
	session := resolveTargetSession(ctx.prefix, ctx.agents, target)
	if !tmuxSessionExists(session) {
		fmt.Printf("tmux session not found: %s\n\n", session)
		printAttachHelp(ctx.prefix, ctx.agents)
		return errExit(1)
	}
	cmd := exec.Command("tmux", "attach-session", "-t", session)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func listProjects(root string) error {
	paths := discoverTeamFiles(root)
	if len(paths) == 0 {
		fmt.Println("No team files found under teams/*.toml or projects/*.toml.")
		return nil
	}
	fmt.Printf("%-22s %-7s %-28s %s\n", "Project", "Port", "Tmux prefix", "Team file")
	for _, path := range paths {
		cfg, err := loadProjectConfig(root, path)
		stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		if err != nil {
			fmt.Printf("%-22s %-7s %-28s %s (%v)\n", stem, "error", "invalid", path, err)
			continue
		}
		name := cfg.Project.Name
		if name == "" {
			name = stem
		}
		prefix := cfg.Project.TmuxPrefix
		if prefix == "" {
			prefix = "agentchattr-" + slug(name)
		}
		fmt.Printf("%-22s %-7d %-28s %s\n", name, cfg.Server.Port, prefix, path)
	}
	return nil
}

func startWrapper(ctx context, agent string) error {
	_, wrapperSession := agentSessions(ctx.prefix, agent)
	command := shellCommand(envForProject(ctx.teamFile, ctx.prefix), wrapperCmdArgs(ctx.root, ctx.team, agent, ctx.prefix))
	return startTmuxSession(ctx.root, wrapperSession, command)
}

func startTmuxSession(root, name, command string) error {
	cmd := exec.Command("tmux", "new-session", "-d", "-s", name, "-c", root, command)
	if out, err := cmd.CombinedOutput(); err != nil {
		text := strings.TrimSpace(string(out))
		if text != "" {
			return fmt.Errorf("Failed to start tmux session %s (exit %v).\nCommand: %s\n%s", name, err, command, text)
		}
		return fmt.Errorf("Failed to start tmux session %s (exit %v).\nCommand: %s", name, err, command)
	}
	return nil
}

func tmuxSessionExists(name string) bool {
	return exec.Command("tmux", "has-session", "-t", name).Run() == nil
}

func tmuxSessions() []string {
	out, err := exec.Command("tmux", "list-sessions", "-F", "#{session_name}").Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(string(out), "\n")
	var sessions []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			sessions = append(sessions, line)
		}
	}
	return sessions
}

func killTmuxSession(name string) {
	_ = exec.Command("tmux", "kill-session", "-t", name).Run()
}

func hostPortOpen(host string, port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(probeHost(host), strconv.Itoa(port)), 200*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func waitForPort(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if hostPortOpen("127.0.0.1", port) {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

func probeHost(host string) string {
	host = strings.TrimSpace(host)
	if host == "" || host == "0.0.0.0" || host == "::" {
		return "127.0.0.1"
	}
	return host
}

func serverState(tmuxRunning, listening bool) string {
	if tmuxRunning && listening {
		return "running"
	}
	if listening {
		return "listening"
	}
	if tmuxRunning {
		return "tmux only"
	}
	return "stopped"
}

func listeningState(listening bool) string {
	if listening {
		return "listening"
	}
	return "closed"
}

func agentState(liveRunning, wrapperRunning bool) string {
	if liveRunning && wrapperRunning {
		return "running"
	}
	if wrapperRunning {
		return "wrapper only"
	}
	if liveRunning {
		return "live only"
	}
	return "stopped"
}

func printAttachHelp(prefix string, agents []string) {
	fmt.Println("Attach targets:")
	fmt.Printf("  server            tmux attach -t %s-server\n", prefix)
	for _, agent := range agents {
		fmt.Printf("  %-16s tmux attach -t %s-%s\n", agent, prefix, agent)
	}
	fmt.Println()
	fmt.Println("Wrapper supervisor sessions are available as wrapper:<agent> when debugging orchestration.")
}

func serverLogPath(root string, team Config) string {
	return filepath.Join(resolveProjectPath(root, team.Server.DataDir), "server.log")
}

func resolveProjectPath(root, raw string) string {
	path := expandHome(raw)
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(root, path))
}

func tailFile(path string, lines int) (string, error) {
	fh, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer fh.Close()
	ring := make([]string, lines)
	count := 0
	scanner := bufio.NewScanner(fh)
	for scanner.Scan() {
		ring[count%lines] = scanner.Text()
		count++
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	start := 0
	if count > lines {
		start = count % lines
		count = lines
	}
	out := make([]string, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, ring[(start+i)%lines])
	}
	return strings.Join(out, "\n"), nil
}

func shQuote(value string) string {
	if value == "" {
		return "''"
	}
	safe := true
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' ||
			r >= 'A' && r <= 'Z' ||
			r >= '0' && r <= '9' ||
			strings.ContainsRune("@%_+=:,./-", r)) {
			safe = false
			break
		}
	}
	if safe {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func fileExists(path string) bool {
	_, err := os.Stat(expandHome(path))
	return err == nil
}

func expandHome(path string) string {
	if path == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
	}
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

func isExecutable(info os.FileInfo) bool {
	return info.Mode()&0o111 != 0
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func appendIfMissing(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func missingLabel(value string) string {
	if strings.TrimSpace(value) == "" {
		return "<missing>"
	}
	return value
}

type exitError struct {
	code int
	msg  string
}

func (e exitError) Error() string {
	return e.msg
}

func errExit(code int) error {
	return exitError{code: code}
}

func errExitMsg(code int, msg string) error {
	return exitError{code: code, msg: msg}
}
