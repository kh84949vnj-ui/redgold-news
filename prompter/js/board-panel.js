// News rundown: the week's school board agenda, with a checkbox per item.
// Checking adds a plain-English line to the script; unchecking takes it out.
// Choices are kept with the news script (meta.board: key -> the added text).
import { boardLine, itemKey } from "./board.js";

/**
 * @param {object} app  what the panel needs from the page:
 *   box            the panel element
 *   meetings()     this week's board meetings (or [])
 *   picked()       {key: text} already added
 *   setPicked(m)   save {key: text}
 *   editor         the script editor (insert/remove/replaceParagraph)
 *   oneAnchor()    true when the script has one anchor
 *   note(text)     show a short message
 *   changed()      refresh the rest of the page
 */
export function boardPanel(app) {
  let studentOnly = true;

  function render() {
    const box = app.box;
    const meetings = app.meetings();
    box.hidden = !meetings.length;
    if (!meetings.length) { box.replaceChildren(); return; }
    const picked = app.picked();
    const wasOpen = box.querySelector("details")?.open;
    const det = document.createElement("details");
    det.open = wasOpen ?? Object.keys(picked).length > 0;
    const sum = document.createElement("summary");
    const n = Object.keys(picked).length;
    const count = meetings.reduce((a, m) => a + m.items.length, 0);
    sum.append("School board this week ");
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = `· ${count ? count + " agenda items" : "agenda not posted yet"}${n ? ` · ${n} added to the script` : ""}`;
    sum.appendChild(sub);
    det.appendChild(sum);
    const body = document.createElement("div");
    body.className = "board-body";
    const tip = document.createElement("p");
    tip.className = "fine";
    tip.textContent = "Check an item to add a line about it to the script. Uncheck to take it out. Flagged items need the adviser first.";
    body.appendChild(tip);
    if (count) {
      const tools = document.createElement("label");
      tools.className = "board-tools";
      const only = document.createElement("input");
      only.type = "checkbox"; only.checked = studentOnly; only.id = "boardOnly";
      only.onchange = () => { studentOnly = only.checked; render(); };
      tools.append(only, " Show only items marked student interest");
      body.appendChild(tools);
    }
    for (const m of meetings) {
      const head = document.createElement("p");
      head.className = "fine";
      head.append(`${m.title}, ${m.when} · `);
      const a = document.createElement("a");
      a.href = m.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Full agenda";
      head.appendChild(a);
      body.appendChild(head);
      const ul = document.createElement("ul");
      ul.className = "board-list";
      for (const it of (m.items.length ? m.items : [null])) {
        const key = itemKey(m, it);
        if (it && studentOnly && !it.student_interest && !picked[key]) continue;
        const li = document.createElement("li");
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!picked[key];
        cb.disabled = !!(it && it.flagged);
        if (cb.disabled) lab.className = "off";
        cb.onchange = () => toggle(m, it, cb.checked);
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = it ? it.number : "";
        const txt = document.createElement("span");
        txt.textContent = it ? it.text.replace(/,?\s*(presented by|item lead:).*/i, "") : "Mention the meeting (the agenda isn't posted yet)";
        if (it && it.student_interest) { const b = document.createElement("span"); b.className = "si"; b.textContent = "student interest"; txt.appendChild(b); }
        if (it && it.flagged) { const b = document.createElement("span"); b.className = "flag"; b.textContent = "see adviser"; txt.appendChild(b); }
        lab.append(cb, num, txt);
        li.appendChild(lab);
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    det.appendChild(body);
    box.replaceChildren(det);
  }

  function toggle(meeting, item, on) {
    const picked = { ...app.picked() };
    const key = itemKey(meeting, item);
    const sameMeeting = (k) => k.startsWith(meeting.url + "#");
    if (on) {
      const text = boardLine(meeting, item, !Object.keys(picked).some(sameMeeting));
      picked[key] = text;
      app.setPicked(picked);
      app.editor.insertParagraph(text, /ADD CAMPUS STORY/, app.oneAnchor());
      app.note("Added to the script.");
    } else {
      const text = picked[key];
      delete picked[key];
      // If this line opened with the meeting time, the next item takes over.
      const nextKey = text && text.startsWith("The school board") && Object.keys(picked).find(sameMeeting);
      if (nextKey) {
        const nextItem = meeting.items.find((it) => itemKey(meeting, it) === nextKey) || null;
        const fresh = boardLine(meeting, nextItem, true);
        if (app.editor.replaceParagraph(picked[nextKey], fresh)) picked[nextKey] = fresh;
      }
      app.setPicked(picked);
      if (text && app.editor.removeParagraph(text)) app.note("Taken out of the script.");
      else app.note("That line was edited, so it's still in the script. Delete it there if you don't want it.");
    }
    app.changed();
  }

  return { render };
}
