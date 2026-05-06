import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from router import Router


class RouterMentionTests(unittest.TestCase):
    def test_hyphenated_agent_name_is_parsed_as_full_mention(self):
        router = Router(["telegram-bridge"], default_mention="none")

        self.assertEqual(
            set(router.parse_mentions("please ask @telegram-bridge to check")),
            {"telegram-bridge"},
        )

    def test_shorter_agent_name_does_not_match_prefix_of_hyphenated_unknown(self):
        router = Router(["telegram"], default_mention="none")

        self.assertEqual(router.parse_mentions("@telegram-bridge check"), [])
        self.assertEqual(router.get_targets("ben", "@telegram-bridge check"), [])

    def test_longest_hyphenated_name_wins_when_prefix_agent_also_exists(self):
        router = Router(["telegram", "telegram-bridge"], default_mention="none")

        self.assertEqual(
            set(router.parse_mentions("@telegram-bridge check")),
            {"telegram-bridge"},
        )

    def test_unknown_exact_handle_still_does_not_route(self):
        router = Router(["telegram-bridge"], default_mention="none")

        self.assertEqual(router.parse_mentions("@telegram-bot check"), [])
        self.assertEqual(router.get_targets("ben", "@telegram-bot check"), [])

    def test_inline_code_mentions_do_not_route(self):
        router = Router(["telegram-bridge", "builder"], default_mention="none")

        self.assertEqual(router.parse_mentions("Document `@telegram-bridge` here"), [])
        self.assertEqual(router.get_targets("ben", "Document `@telegram-bridge` here"), [])
        self.assertEqual(
            set(router.parse_mentions("Document `@telegram-bridge` but ping @builder")),
            {"builder"},
        )

    def test_fenced_code_mentions_do_not_route(self):
        router = Router(["telegram-bridge", "builder"], default_mention="none")
        text = "Please do not route this:\n```text\n@telegram-bridge\n```\nBut route @builder"

        self.assertEqual(set(router.parse_mentions(text)), {"builder"})
        self.assertEqual(router.get_targets("ben", "```python\n@telegram-bridge\n```"), [])

    def test_tilde_fenced_code_mentions_do_not_route(self):
        router = Router(["telegram-bridge"], default_mention="none")

        self.assertEqual(router.parse_mentions("~~~\n@telegram-bridge\n~~~"), [])

    def test_code_quoted_all_does_not_route_online_agents(self):
        router = Router(["builder", "reviewer"], default_mention="none",
                        online_checker=lambda: {"builder", "reviewer"})

        self.assertEqual(router.parse_mentions("Use `@all` in docs"), [])
        self.assertEqual(set(router.parse_mentions("Use `@all` in docs, then ping @all")), {"builder", "reviewer"})

    def test_team_mentions_route_to_matching_agents(self):
        router = Router(["cb1", "cr1", "cb2", "solo"], default_mention="none")
        router.update_agent_metadata(teams={
            "cb1": "1",
            "cr1": "1",
            "cb2": "2",
            "solo": "",
        })

        self.assertEqual(set(router.parse_mentions("@team:1 please review")), {"cb1", "cr1"})
        self.assertEqual(set(router.parse_mentions("@team:2 please build")), {"cb2"})
        self.assertEqual(router.parse_mentions("@team:unknown"), [])
        self.assertEqual(set(router.parse_mentions("@TEAM:1 please review")), {"cb1", "cr1"})

    def test_team_mentions_allow_internal_dots_without_capturing_trailing_punctuation(self):
        router = Router(["stable", "point-release"], default_mention="none")
        router.update_agent_metadata(teams={
            "stable": "1",
            "point-release": "1.0",
        })

        self.assertEqual(set(router.parse_mentions("@team:1.")), {"stable"})
        self.assertEqual(set(router.parse_mentions("@team:1.0.")), {"point-release"})

    def test_role_mentions_route_to_matching_agents(self):
        router = Router(["builder-one", "builder-two", "reviewer"], default_mention="none")
        router.update_agent_metadata(roles={
            "builder-one": "Builder",
            "builder-two": "builder",
            "reviewer": "Reviewer",
        })

        self.assertEqual(
            set(router.parse_mentions("@role:Builder take this")),
            {"builder-one", "builder-two"},
        )
        self.assertEqual(set(router.parse_mentions("@role:Reviewer check this")), {"reviewer"})
        self.assertEqual(set(router.parse_mentions("@role:Builder.")), {"builder-one", "builder-two"})

    def test_metadata_mentions_normalize_spaces_underscores_and_case(self):
        router = Router(["planner", "reviewer"], default_mention="none")
        router.update_agent_metadata(roles={
            "planner": "Red Team",
            "reviewer": "red_team",
        })

        self.assertEqual(set(router.parse_mentions("@role:RED-Team")), {"planner", "reviewer"})

    def test_metadata_mentions_do_not_route_from_code_spans_or_fences(self):
        router = Router(["builder", "reviewer"], default_mention="none")
        router.update_agent_metadata(
            teams={"builder": "1"},
            roles={"reviewer": "Builder"},
        )
        text = "Document `@team:1` here:\n```text\n@role:Builder\n```\n"

        self.assertEqual(router.parse_mentions(text), [])

    def test_empty_metadata_mentions_and_non_string_metadata_do_not_route(self):
        router = Router(["builder", "reviewer"], default_mention="none")
        router.update_agent_metadata(
            teams={"builder": None},
            roles={"reviewer": None},
        )

        self.assertEqual(router.parse_mentions("@team:"), [])
        self.assertEqual(router.parse_mentions("@role:"), [])
        self.assertEqual(router.parse_mentions("@team:none @role:none"), [])

    def test_agent_named_team_is_not_pinged_by_team_route_token(self):
        router = Router(["team", "builder"], default_mention="none")
        router.update_agent_metadata(teams={"builder": "1"})

        self.assertEqual(set(router.parse_mentions("@team:1")), {"builder"})
        self.assertEqual(set(router.parse_mentions("@team please check")), {"team"})

    def test_role_mentions_do_not_route_back_to_sender(self):
        router = Router(["builder", "reviewer"], default_mention="none")
        router.update_agent_metadata(roles={
            "builder": "Builder",
            "reviewer": "Builder",
        })

        self.assertEqual(set(router.get_targets("builder", "@role:Builder")), {"reviewer"})

    def test_team_mentions_do_not_route_back_to_sender(self):
        router = Router(["builder", "reviewer"], default_mention="none")
        router.update_agent_metadata(teams={
            "builder": "1",
            "reviewer": "1",
        })

        self.assertEqual(set(router.get_targets("builder", "@team:1")), {"reviewer"})

    def test_metadata_mentions_use_loop_guard_hop_counting(self):
        router = Router(["builder", "reviewer"], default_mention="none", max_hops=1)
        router.update_agent_metadata(teams={
            "builder": "1",
            "reviewer": "1",
        })

        self.assertEqual(set(router.get_targets("builder", "@team:1")), {"reviewer"})
        self.assertEqual(router.get_targets("reviewer", "@team:1"), [])
        self.assertTrue(router.is_paused())


if __name__ == "__main__":
    unittest.main()
