import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app  # noqa: E402
from store import MessageStore  # noqa: E402


class MessageSearchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = MessageStore(str(Path(self.tmp.name) / "messages.jsonl"))

    def test_plain_query_matches_body_not_channel_or_sender_description(self):
        self.store.add("alice", "Plain update", channel="general")
        body_match = self.store.add("bob", "This mentions general explicitly.", channel="planning")
        self.store.add("generalist", "Sender name only should not match.", channel="random")

        payload = self.store.search("general")

        self.assertEqual([m["id"] for m in payload["results"]], [body_match["id"]])
        self.assertEqual(payload["facets"]["channels"], ["general", "planning", "random"])
        self.assertEqual(payload["facets"]["senders"], ["alice", "bob", "generalist"])

    def test_sender_query_requires_at_prefix(self):
        sender_match = self.store.add("alice", "No matching body text.", channel="general")
        body_match = self.store.add("bob", "alice appears in the body.", channel="general")

        self.assertEqual(
            [m["id"] for m in self.store.search("@ali")["results"]],
            [sender_match["id"]],
        )
        self.assertEqual(
            [m["id"] for m in self.store.search("alice")["results"]],
            [body_match["id"]],
        )

    def test_filters_match_todos_jobs_sessions_and_system_messages(self):
        todo_msg = self.store.add("alice", "Track this.", channel="general")
        done_msg = self.store.add("bob", "Finished this.", channel="general")
        job_msg = self.store.add("codex", "Job update.", channel="general", metadata={"job_id": "job-1"})
        session_msg = self.store.add("codex", "Session output.", msg_type="session", channel="general")
        system_msg = self.store.add("system", "Joined.", msg_type="join", channel="general")
        self.assertTrue(self.store.add_todo(todo_msg["id"]))
        self.assertTrue(self.store.add_todo(done_msg["id"]))
        self.assertTrue(self.store.complete_todo(done_msg["id"]))

        self.assertEqual(
            {m["id"] for m in self.store.search(pinned=True)["results"]},
            {todo_msg["id"], done_msg["id"]},
        )
        self.assertEqual([m["id"] for m in self.store.search(todo=True)["results"]], [todo_msg["id"]])
        self.assertEqual([m["id"] for m in self.store.search(done=True)["results"]], [done_msg["id"]])
        self.assertEqual([m["id"] for m in self.store.search(jobs=True)["results"]], [job_msg["id"]])
        self.assertEqual([m["id"] for m in self.store.search(session=True)["results"]], [session_msg["id"]])
        self.assertEqual([m["id"] for m in self.store.search(system=True)["results"]], [system_msg["id"]])

    def test_api_returns_search_payload_and_clamps_limit(self):
        old_store = app.store
        try:
            app.store = self.store
            first = self.store.add("alice", "needle one", channel="general")
            second = self.store.add("bob", "needle two", channel="general")

            payload = asyncio.run(app.search_messages(q="needle", limit=999))

            self.assertEqual(payload["limit"], 500)
            self.assertEqual([m["id"] for m in payload["results"]], [second["id"], first["id"]])
            self.assertEqual(payload["returned"], 2)
            self.assertEqual(payload["facets"]["senders"], ["alice", "bob"])
        finally:
            app.store = old_store

    def test_message_window_returns_target_slice_with_todo_status(self):
        messages = [
            self.store.add("alice", f"general {i}", channel="general")
            for i in range(6)
        ]
        self.store.add("bob", "other channel", channel="random")
        self.assertTrue(self.store.add_todo(messages[2]["id"]))

        payload = self.store.get_window_around(messages[3]["id"], before=2, after=1, channel="general")

        self.assertEqual([m["id"] for m in payload["messages"]], [1, 2, 3, 4])
        self.assertEqual(payload["target_id"], messages[3]["id"])
        self.assertEqual(payload["channel"], "general")
        self.assertTrue(payload["has_before"])
        self.assertTrue(payload["has_after"])
        todo_row = next(m for m in payload["messages"] if m["id"] == messages[2]["id"])
        self.assertEqual(todo_row["todo_status"], "todo")

    def test_api_message_window_404s_when_target_not_found_in_channel(self):
        old_store = app.store
        try:
            app.store = self.store
            msg = self.store.add("alice", "find me", channel="general")

            ok_payload = asyncio.run(app.get_message_window(message_id=msg["id"], before=1, after=1, channel="general"))
            missing = asyncio.run(app.get_message_window(message_id=msg["id"], channel="random"))

            self.assertEqual(ok_payload["target_id"], msg["id"])
            self.assertEqual(missing.status_code, 404)
        finally:
            app.store = old_store


if __name__ == "__main__":
    unittest.main()
