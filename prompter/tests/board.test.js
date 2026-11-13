import test from "node:test";
import assert from "node:assert/strict";
import { plainItem, boardLine, meetingWhen } from "../js/board.js";

const meeting = { when: "Wednesday, November 18, 6:00 PM", title: "Regular Meeting", url: "u", agenda_pending: false };

test("agenda wording becomes plain phrases", () => {
  assert.equal(plainItem("Approval of Purchase for Dual Enrollment Textbooks for the Spring 2027 Semester for Jimmy Carter ECHS"),
    "whether to approve the purchase for Dual Enrollment Textbooks for the Spring 2027 semester for Jimmy Carter ECHS");
  assert.equal(plainItem("Approval of SAT Exam Purchase for the 2026-2027 School Year Through the Student Testing and Assessment RFP"),
    "whether to approve SAT exam purchase for the 2026-2027 school year through the student Testing and Assessment RFP");
  assert.equal(plainItem("Recognition of National School Psychologist Week November 9-13, 2026, presented by Ms. Someone, Deputy Chief"),
    "a recognition of National School Psychologist Week November 9-13, 2026");
  assert.equal(plainItem("Approval of Library Books Recommended"), "whether to approve library books recommended");
  assert.equal(plainItem("2026-2027 District Improvement Plan and Campus Improvement Plans"),
    "the 2026-2027 District Improvement plan and campus improvement plans");
});

test("meeting time reads naturally", () => {
  assert.deepEqual(meetingWhen("Wednesday, November 18, 6:00 PM"), { day: "Wednesday", time: "6 p.m." });
  assert.deepEqual(meetingWhen("Tuesday, December 1, 5:30 PM"), { day: "Tuesday", time: "5:30 p.m." });
});

test("first item opens with the meeting, later ones say also", () => {
  const item = { number: "7.5.1", text: "Approval of Library Books Recommended" };
  assert.equal(boardLine(meeting, item, true),
    "The school board meets Wednesday at 6 p.m. One thing on the agenda is whether to approve library books recommended.");
  assert.equal(boardLine(meeting, item, false), "The board will also look at whether to approve library books recommended.");
  assert.match(boardLine(meeting, null, true), /agenda will be posted on BoardBook/);
});

test("long items get a simplify note", () => {
  const item = { number: "7.7.2", text: "Approval of Additional Architectural Services for the District-Wide Entry Door Hardening Project by the Engineering & Architecture Firm Through the Purchasing Cooperative Contract" };
  assert.match(boardLine(meeting, item, true), /\[SIMPLIFY: put this in your own words\]$/);
});
