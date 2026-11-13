// Board agenda items -> lines an anchor can read.
//
// Agenda titles are written for the record ("Approval of Purchase for Dual
// Enrollment Textbooks for the Spring 2027 Semester for Jimmy Carter ECHS,
// presented by …"). This turns them into a plain phrase and a sentence, and
// adds a [SIMPLIFY] note when the phrase is still long.

const PREFIXES = [
  [/^consider and take (possible )?action (to|on) /i, "whether to "],
  [/^approval to /i, "whether to "],
  [/^approval of /i, "whether to approve "],
  [/^recognition of /i, "a recognition of "],
  [/^report on /i, "a report on "],
  [/^announcement of /i, "an announcement of "],
  [/^discussion (of|on) /i, "a discussion of "],
  [/^discuss /i, "a discussion of "],
  [/^update on /i, "an update on "],
];

/** "Approval of Purchase for X, presented by Y" -> "whether to approve the purchase for X" */
export function plainItem(text) {
  let t = String(text)
    .replace(/,?\s*(presented by|item lead:).*/i, "")       // who presents it
    .replace(/\s*\((texas )?government code[^)]*\)/gi, "")  // legal citations
    .replace(/\s*\([^)]*\)\s*$/, "")                         // trailing (dates)
    .replace(/[\s.:-]+$/, "")
    .trim();
  for (const [re, lead] of PREFIXES) {
    if (re.test(t)) {
      let rest = t.replace(re, "");
      if (lead.endsWith("approve ") && /^(purchase|memorandum|change order|agreement|contract|report|renewal|policy|budget|donation)/i.test(rest)) {
        rest = "the " + rest;
      }
      return lead + plainCase(rest);
    }
  }
  return "the " + plainCase(t.replace(/^the\s+/i, ""));
}

// Record-keeping words that agendas capitalize but people don't say that way.
// Names, acronyms (SAT, TELPAS, ECHS) and anything else stay as written.
const COMMON = new Set(("purchase purchases approval books book recommended library report reports renewal " +
  "license licenses order change memorandum understanding project services service replacement renovation " +
  "renovations field plan plans semester year exam textbooks program programs support professional development " +
  "instructional additional district-wide districtwide exterior door doors gate numbering signage window film " +
  "resistant quotation through purchasing cooperative cooperatives contract contracts agreement policy update " +
  "budget transfer amendments open period tax collectors' recognition observance improvement campus targeted " +
  "goals benchmark aligned action recommendations time use tracker self-assessment instrument architectural " +
  "entry hardening key cores cooling tower crew cab passenger van sports complex baseball users user special " +
  "education department's department appraiser called meeting recognitions student students school").split(" "));

function plainCase(s) {
  // A common word right after a name-like capitalized word is part of the
  // name ("National School Psychologist Week"), so it keeps its capital.
  const words = s.split(" ");
  const isName = (w) => /^[A-Z][a-z'-]*$/.test(w) && !COMMON.has(w.toLowerCase());
  return words.map((w, i) => (COMMON.has(w.toLowerCase()) && /^[A-Z][a-z'-]*$/.test(w) && !(i > 0 && isName(words[i - 1]))
    ? w.toLowerCase() : w)).join(" ");
}

function sayTime(t) {
  const m = String(t || "").match(/(\d{1,2}):(\d\d) ([AP])M/i);
  if (!m) return t;
  return `${m[1]}${m[2] === "00" ? "" : ":" + m[2]} ${m[3].toLowerCase()}.m.`;
}

/** "Wednesday, November 18, 6:00 PM" -> {day: "Wednesday", time: "6 p.m."} */
export function meetingWhen(when) {
  const day = String(when).split(",")[0].trim();
  const time = sayTime(String(when).split(",").pop().trim());
  return { day, time };
}

function meetingIntro(meeting) {
  const { day, time } = meetingWhen(meeting.when);
  const end = time.endsWith(".") ? "" : ".";
  const title = String(meeting.title || "").trim();
  if (/^(regular|special|called)/i.test(title) || /workshop/i.test(title)) {
    return `The school board meets ${day} at ${time}${end}`;
  }
  return `The school board's ${title.replace(/\s*meeting$/i, "").toLowerCase()} meets ${day} at ${time}${end}`;
}

/**
 * The sentence(s) for one checked item. `first` = no other item from this
 * meeting is in the script yet, so this one opens with the meeting time.
 * item === null means "just mention the meeting" (agenda not posted).
 */
export function boardLine(meeting, item, first) {
  if (!item) return `${meetingIntro(meeting)} The agenda will be posted on BoardBook.`;
  const phrase = plainItem(item.text);
  const long = phrase.split(/\s+/).length > 16 ? " [SIMPLIFY: put this in your own words]" : "";
  return first
    ? `${meetingIntro(meeting)} One thing on the agenda is ${phrase}.${long}`
    : `The board will also look at ${phrase}.${long}`;
}

/** Stable key for a checkbox. */
export function itemKey(meeting, item) {
  return `${meeting.url}#${item ? item.number : "meeting"}`;
}
