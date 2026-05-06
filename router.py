"""Message routing based on @mentions with per-channel loop guard."""

import re


_TEAM_ROLE_RE = re.compile(
    r"@(team|role):([a-zA-Z0-9](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9])?)(?=$|[\s.,;:!?)}\]])",
    re.IGNORECASE,
)


def _metadata_key(value: str) -> str:
    return re.sub(r"[\s_]+", "-", str(value).strip().lower())


def _fence_at(text: str, idx: int) -> tuple[str, int] | None:
    ch = text[idx]
    if ch not in ("`", "~"):
        return None
    line_start = text.rfind("\n", 0, idx) + 1
    prefix = text[line_start:idx]
    if len(prefix) > 3 or prefix.strip(" "):
        return None
    run = 0
    while idx + run < len(text) and text[idx + run] == ch:
        run += 1
    if run < 3:
        return None
    return ch, run


def _skip_fenced_code(text: str, start: int, ch: str, length: int) -> int:
    line_end = text.find("\n", start)
    if line_end == -1:
        return len(text)
    pos = line_end + 1
    while pos < len(text):
        next_line = text.find("\n", pos)
        line_end = len(text) if next_line == -1 else next_line
        i = pos
        spaces = 0
        while i < line_end and text[i] == " " and spaces < 4:
            i += 1
            spaces += 1
        if spaces <= 3:
            run = 0
            while i + run < line_end and text[i + run] == ch:
                run += 1
            if run >= length:
                return line_end + (1 if next_line != -1 else 0)
        if next_line == -1:
            return len(text)
        pos = next_line + 1
    return len(text)


def _strip_markdown_code(text: str) -> str:
    parts = []
    last = 0
    i = 0
    while i < len(text):
        fence = _fence_at(text, i)
        if fence:
            parts.append(text[last:i])
            i = _skip_fenced_code(text, i, fence[0], fence[1])
            last = i
            continue
        if text[i] == "`":
            run = 1
            while i + run < len(text) and text[i + run] == "`":
                run += 1
            close = text.find("`" * run, i + run)
            if close != -1:
                parts.append(text[last:i])
                i = close + run
                last = i
                continue
            i += run
            continue
        i += 1
    parts.append(text[last:])
    return "".join(parts)


class Router:
    def __init__(self, agent_names: list[str], default_mention: str = "both",
                 max_hops: int = 4, online_checker=None):
        self.agent_names = set(n.lower() for n in agent_names)
        self._agent_teams: dict[str, str] = {}
        self._agent_roles: dict[str, str] = {}
        self.default_mention = default_mention
        self.max_hops = max_hops
        self._online_checker = online_checker  # callable() -> set of online agent names
        # Per-channel state: { channel: { hop_count, paused, guard_emitted } }
        self._channels: dict[str, dict] = {}
        self._build_pattern()

    def _get_ch(self, channel: str) -> dict:
        if channel not in self._channels:
            self._channels[channel] = {
                "hop_count": 0,
                "paused": False,
                "guard_emitted": False,
            }
        return self._channels[channel]

    def _build_pattern(self):
        # Sort longest-first so "gemini-2" is tried before "gemini"
        names = [re.escape(n) for n in sorted(self.agent_names, key=len, reverse=True)]
        alternatives = "|".join(names + ["both", "all"])
        self._mention_re = re.compile(
            rf"@({alternatives})(?![\w-])", re.IGNORECASE
        )

    def parse_mentions(self, text: str) -> list[str]:
        text = _strip_markdown_code(text)
        mentions = set()
        for match in _TEAM_ROLE_RE.finditer(text):
            kind = match.group(1).lower()
            value = _metadata_key(match.group(2))
            metadata = self._agent_teams if kind == "team" else self._agent_roles
            mentions.update(
                name for name, current in metadata.items()
                if current == value and name in self.agent_names
            )
        for match in self._mention_re.finditer(text):
            name = match.group(1).lower()
            if name in ("team", "role") and match.end() < len(text) and text[match.end()] == ":":
                continue
            if name in ("both", "all"):
                # Only tag online agents when using @all
                if self._online_checker:
                    online = self._online_checker()
                    mentions.update(n for n in self.agent_names if n in online)
                else:
                    mentions.update(self.agent_names)
            else:
                mentions.add(name)
        return list(mentions)

    def _is_agent(self, sender: str) -> bool:
        return sender.lower() in self.agent_names

    def get_targets(self, sender: str, text: str, channel: str = "general") -> list[str]:
        """Determine which agents should receive this message."""
        ch = self._get_ch(channel)
        mentions = self.parse_mentions(text)

        if not self._is_agent(sender):
            # Human message resets hop counter and unpauses
            ch["hop_count"] = 0
            ch["paused"] = False
            ch["guard_emitted"] = False
            if not mentions:
                if self.default_mention in ("both", "all"):
                    return list(self.agent_names)
                elif self.default_mention == "none":
                    return []
                return [self.default_mention]
            return mentions
        else:
            # Agent message: blocked while loop guard is active
            if ch["paused"]:
                return []
            # Only route if explicit @mention
            if not mentions:
                return []
            ch["hop_count"] += 1
            if ch["hop_count"] > self.max_hops:
                ch["paused"] = True
                return []
            # Don't route back to self
            return [m for m in mentions if m != sender]

    def continue_routing(self, channel: str = "general"):
        """Resume after loop guard pause."""
        ch = self._get_ch(channel)
        ch["hop_count"] = 0
        ch["paused"] = False
        ch["guard_emitted"] = False

    def is_paused(self, channel: str = "general") -> bool:
        return self._get_ch(channel)["paused"]

    def is_guard_emitted(self, channel: str = "general") -> bool:
        return self._get_ch(channel)["guard_emitted"]

    def set_guard_emitted(self, channel: str = "general"):
        self._get_ch(channel)["guard_emitted"] = True

    def update_agents(self, names: list[str]):
        """Replace the agent name set and rebuild the mention regex."""
        self.agent_names = set(n.lower() for n in names)
        self._build_pattern()

    def update_agent_metadata(self, teams: dict[str, str] | None = None,
                              roles: dict[str, str] | None = None):
        """Replace routing metadata used by @team:<name> and @role:<name>."""
        self._agent_teams = {
            str(name).lower(): _metadata_key(team)
            for name, team in (teams or {}).items()
            if isinstance(team, str) and team.strip()
        }
        self._agent_roles = {
            str(name).lower(): _metadata_key(role)
            for name, role in (roles or {}).items()
            if isinstance(role, str) and role.strip()
        }
