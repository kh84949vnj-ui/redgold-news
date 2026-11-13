"""Board agenda items -> lines an anchor can read.

Same wording as prompter/js/board.js (tests/test_board.py checks they match),
so an item picked on the Story Desk reads the same as one picked in the
prompter's board panel.
"""
from __future__ import annotations

import re

PREFIXES = [
    (r"^consider and take (possible )?action (to|on) ", "whether to "),
    (r"^approval to ", "whether to "),
    (r"^approval of ", "whether to approve "),
    (r"^recognition of ", "a recognition of "),
    (r"^report on ", "a report on "),
    (r"^announcement of ", "an announcement of "),
    (r"^discussion (of|on) ", "a discussion of "),
    (r"^discuss ", "a discussion of "),
    (r"^update on ", "an update on "),
]

COMMON = set((
    "purchase purchases approval books book recommended library report reports renewal "
    "license licenses order change memorandum understanding project services service replacement renovation "
    "renovations field plan plans semester year exam textbooks program programs support professional development "
    "instructional additional district-wide districtwide exterior door doors gate numbering signage window film "
    "resistant quotation through purchasing cooperative cooperatives contract contracts agreement policy update "
    "budget transfer amendments open period tax collectors' recognition observance improvement campus targeted "
    "goals benchmark aligned action recommendations time use tracker self-assessment instrument architectural "
    "entry hardening key cores cooling tower crew cab passenger van sports complex baseball users user special "
    "education department's department appraiser called meeting recognitions student students school"
).split())

CAP = re.compile(r"^[A-Z][a-z'-]*$")


def _plain_case(s: str) -> str:
    words = s.split(" ")
    is_name = lambda w: bool(CAP.match(w)) and w.lower() not in COMMON
    out = []
    for i, w in enumerate(words):
        if w.lower() in COMMON and CAP.match(w) and not (i > 0 and is_name(words[i - 1])):
            out.append(w.lower())
        else:
            out.append(w)
    return " ".join(out)


def plain_item(text: str) -> str:
    t = re.sub(r",?\s*(presented by|item lead:).*", "", str(text), flags=re.I)
    t = re.sub(r"\s*\((texas )?government code[^)]*\)", "", t, flags=re.I)
    t = re.sub(r"\s*\([^)]*\)\s*$", "", t)
    t = re.sub(r"[\s.:-]+$", "", t).strip()
    for pat, lead in PREFIXES:
        if re.match(pat, t, re.I):
            rest = re.sub(pat, "", t, count=1, flags=re.I)
            if lead.endswith("approve ") and re.match(
                    r"(purchase|memorandum|change order|agreement|contract|report|renewal|policy|budget|donation)", rest, re.I):
                rest = "the " + rest
            return lead + _plain_case(rest)
    return "the " + _plain_case(re.sub(r"^the\s+", "", t, flags=re.I))


def _say_time(t: str) -> str:
    m = re.search(r"(\d{1,2}):(\d\d) ([AP])M", t or "", re.I)
    if not m:
        return t
    return f"{m.group(1)}{'' if m.group(2) == '00' else ':' + m.group(2)} {m.group(3).lower()}.m."


def meeting_when(when: str) -> tuple[str, str]:
    parts = str(when).split(",")
    return parts[0].strip(), _say_time(parts[-1].strip())


def _intro(meeting: dict) -> str:
    day, time = meeting_when(meeting["when"])
    end = "" if time.endswith(".") else "."
    title = str(meeting.get("title", "")).strip()
    if re.match(r"(regular|special|called)", title, re.I) or re.search(r"workshop", title, re.I):
        return f"The school board meets {day} at {time}{end}"
    name = re.sub(r"\s*meeting$", "", title, flags=re.I).lower()
    return f"The school board's {name} meets {day} at {time}{end}"


def board_line(meeting: dict, item: dict | None, first: bool) -> str:
    if item is None:
        return f"{_intro(meeting)} The agenda will be posted on BoardBook."
    phrase = plain_item(item["text"])
    long = " [SIMPLIFY: put this in your own words]" if len(phrase.split()) > 16 else ""
    if first:
        return f"{_intro(meeting)} One thing on the agenda is {phrase}.{long}"
    return f"The board will also look at {phrase}.{long}"


def item_key(meeting: dict, item: dict | None) -> str:
    return f"{meeting['url']}#{item['number'] if item else 'meeting'}"
