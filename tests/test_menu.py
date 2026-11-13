"""Checks on the menu read: python -m unittest discover tests"""
import datetime as dt
import unittest

from rgn.episode import build_script
from rgn.menu import parse_csv, script
from tests.test_episode import WEEK

CSV = """date,weekday,breakfast,lunch
2026-11-16,Monday,Hawaiian Sandwich,Pulled Pork Burger; Ranch Style Beans; Onion Rings
2026-11-17,Tuesday,Kolache,Cherry Blossom Chicken w/ Fried Rice & Egg Roll; Carrot Coins
2026-11-18,Wednesday,,Pizza w/ Wings
"""
DAYS = [dt.date(2026, 11, 16) + dt.timedelta(days=i) for i in range(4)]


class MenuRead(unittest.TestCase):
    def setUp(self):
        self.lines, self.notes = script(DAYS, parse_csv(CSV))

    def test_reads_breakfast_then_lunch(self):
        self.assertEqual(self.lines[1], "On Monday, breakfast is Hawaiian Sandwich. "
                         "For lunch, it's Pulled Pork Burger, plus Ranch Style Beans and Onion Rings.")

    def test_menu_shorthand_is_spelled_out(self):
        self.assertIn("Cherry Blossom Chicken with Fried Rice and Egg Roll", self.lines[2])
        self.assertNotIn("w/", " ".join(self.lines))
        self.assertNotIn("&", " ".join(self.lines))

    def test_lunch_only_day(self):
        self.assertEqual(self.lines[3], "On Wednesday, for lunch, it's Pizza with Wings.")

    def test_missing_day_is_flagged_not_guessed(self):
        self.assertEqual(self.lines[4], "[ADD MENU: Thursday]")
        self.assertEqual(self.notes, ["No menu posted for Thursday, November 19."])

    def test_no_time_of_day_greeting(self):
        self.assertNotRegex(" ".join(self.lines).lower(), r"good (morning|afternoon|evening)")

    def test_menu_block_sits_where_the_menu_airs(self):
        s = build_script({**WEEK, "menu": {"script": self.lines}})
        self.assertIn("[MENU]\nHey, RedWolves! Here's what's cookin' this week.", s)
        self.assertLess(s.index("[CUE STUDENT VOICES]"), s.index("[MENU]"))
        self.assertNotIn("[CUE MENU]", s)

    def test_no_menu_leaves_a_placeholder(self):
        self.assertIn("[MENU]\n[ADD: menu read]", build_script(WEEK))
