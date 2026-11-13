"""Python board wording must match prompter/js/board.js."""
import json
import subprocess
import unittest
from pathlib import Path

from rgn.board import board_line, plain_item

ROOT = Path(__file__).resolve().parent.parent
MEETING = {"when": "Wednesday, November 18, 6:00 PM", "title": "Regular Meeting", "url": "u", "agenda_pending": False}
ITEMS = json.loads((ROOT / "tests" / "fixtures" / "board-items.json").read_text())


class BoardWording(unittest.TestCase):
    def test_matches_javascript(self):
        js = (
            "import('" + (ROOT / "prompter/js/board.js").as_posix() + "').then(m => {"
            "const items = " + json.dumps(ITEMS) + "; const mt = " + json.dumps(MEETING) + ";"
            "console.log(JSON.stringify(items.map((it, i) => m.boardLine(mt, it, i === 0)).concat([m.boardLine(mt, null, true)])));})"
        )
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout
        expected = json.loads(out)
        got = [board_line(MEETING, it, i == 0) for i, it in enumerate(ITEMS)] + [board_line(MEETING, None, True)]
        self.assertEqual(got, expected)

    def test_plain_wording(self):
        self.assertEqual(plain_item("Approval of Library Books Recommended"), "whether to approve library books recommended")


if __name__ == "__main__":
    unittest.main()
