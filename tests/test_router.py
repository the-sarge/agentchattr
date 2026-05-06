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


if __name__ == "__main__":
    unittest.main()
