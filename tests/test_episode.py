"""Checks on the drafted episode script: python -m unittest discover tests"""
import json
import re
import unittest
from pathlib import Path

from rgn.episode import build_script

WEEK = json.loads((Path(__file__).parent / "fixtures" / "week-2026-11-16.json").read_text())


def spoken_sentences(script: str) -> list[str]:
    """What the anchors actually say: no [tags], [cues] or [notes]."""
    text = re.sub(r"\[[^\]]*\]", " ", script)
    text = re.sub(r"\b([ap])\.m\.", r"\1m", text)  # don't split on p.m.
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if re.search(r"[A-Za-z]", s)]


def syllables(word: str) -> int:
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if w.endswith("e") and not w.endswith(("le", "ee")) and n > 1:
        n -= 1
    return max(1, n)


def grade_level(sentences: list[str]) -> float:
    words = [w for s in sentences for w in re.findall(r"[A-Za-z0-9']+", s)]
    syl = sum(syllables(w) for w in words)
    return 0.39 * len(words) / len(sentences) + 11.8 * syl / len(words) - 15.59


class EpisodeScript(unittest.TestCase):
    def setUp(self):
        self.script = build_script(WEEK)
        self.sentences = spoken_sentences(self.script)

    def test_reads_at_middle_school_level(self):
        g = grade_level(self.sentences)
        self.assertLessEqual(g, 7.0, f"reading grade {g:.1f}")

    def test_sentences_are_short(self):
        lengths = [len(s.split()) for s in self.sentences]
        self.assertLessEqual(sum(lengths) / len(lengths), 14, "average sentence length")
        too_long = [s for s in self.sentences if len(s.split()) > 24]
        self.assertEqual(too_long, [], "sentences over 24 words")

    def test_same_week_gives_same_words(self):
        self.assertEqual(build_script(WEEK), build_script(WEEK))

    def test_no_made_up_details(self):
        # Every calendar event title appears, and nothing names a place or
        # person the calendar didn't give (locations stay as VERIFY notes).
        for lead in WEEK["news"]["leads"]:
            self.assertIn(lead["title"].split(" Public")[0], self.script)
        self.assertIn("[VERIFY: location]", self.script)
        self.assertNotIn("Board", self.script)

    def test_flagged_topics_are_notes_only(self):
        week = json.loads(json.dumps(WEEK))
        week["news"]["leads"].append({"date": "2026-11-18", "end": "2026-11-18", "time": "",
                                      "title": "Suicide Prevention Awareness Day", "flagged": True})
        script = build_script(week)
        self.assertIn("[FLAGGED: Suicide Prevention Awareness Day.", script)
        self.assertNotIn("Wednesday is Suicide", script)

    def test_no_time_of_day(self):
        # Episodes air at different times, so nothing says morning, today, etc.
        # ("a morning low of 65" in the forecast is a weather term and is fine).
        spoken = " ".join(spoken_sentences(self.script)).lower().replace("morning low", "")
        for phrase in ["good morning", "good afternoon", "good evening", "this morning", "this afternoon",
                       "tonight", "today", "morning", "afternoon"]:
            self.assertNotIn(phrase, spoken)

    def test_news_flows_in_runs(self):
        # Stories are read in two linked runs, not one short line per anchor.
        news = self.script.split("[CUE INTRO SEQUENCE]")[1].split("[CUE BUMPER]")[0]
        turns = news.count("[ANCHOR 1]\n") + news.count("[ANCHOR 2]\n")
        self.assertLessEqual(turns, 8, news)
        # A little co-anchor banter, but no more than two quick reactions.
        reactions = [p for p in news.split("\n\n") if p.strip().startswith("[ANCHOR") and len(p.split()) <= 12]
        self.assertGreaterEqual(len(reactions), 1, news)
        self.assertLessEqual(len(reactions), 2, news)
        self.assertIn("Then on Thursday", news)

    def test_has_the_rundown(self):
        for cue in ["[CUE INTRO SEQUENCE]", "[CUE BUMPER]", "[WEATHER]", "[CUE STUDENT VOICES]", "[CUE MENU]", "[CUE OUTRO]"]:
            self.assertIn(cue, self.script)


if __name__ == "__main__":
    unittest.main()
