"""The Story Desk's copy of the board wording must match prompter/js/board.js."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("sync", ROOT / "tools" / "sync_storydesk.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class StoryDeskInSync(unittest.TestCase):
    def test_board_wording_matches_prompter(self):
        html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertEqual(sync.current_block(html), sync.inline_board(),
                         "Run: python tools/sync_storydesk.py")


if __name__ == "__main__":
    unittest.main()
