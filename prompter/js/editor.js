// Edit view: the whole script in one box. Cues stay in the text as their own
// lines ([CUE BUMPER]); speakers are [ANCHOR 1] lines; notes like
// [VERIFY: location] sit inside sentences and are never read.
import { todos } from "./segments.js";

const WPM = 150;
const spokenWords = (t) =>
  (t.replace(/\[[^\]]*\]/g, " ").match(/[A-Za-z0-9][\w'’.-]*/g) || []).length;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const TAG = /^\s*\[(ANCHOR\s*\d|BOTH)\]\s*\n/i;

export class Editor {
  /**
   * @param {HTMLElement} root  the editor section (.script-box textarea, .todo, .total inside)
   * @param {object} opts  { onChange(text), names() -> {a1, a2, wx} }
   */
  constructor(root, { onChange, names } = {}) {
    this.root = root;
    this.ta = root.querySelector(".script-box");
    this.todoEl = root.querySelector(".todo");
    this.totalEl = root.querySelector(".total");
    this.onChange = onChange || (() => {});
    this.names = names || (() => ({}));
    this.timer = null;
    this.ta.addEventListener("input", () => {
      this.grow();
      this.updateCounts();
      this.changed();
    });
    window.addEventListener("resize", () => this.grow());
  }

  setText(text) {
    this.ta.value = String(text || "").replace(/\n+$/, "");
    this.grow();
    this.updateCounts();
  }

  getText() { return this.ta.value.replace(/\s+$/, "") + "\n"; }

  // ---------------------------------------------------------------- paragraphs
  paras() { return this.ta.value.split(/\n{2,}/); }

  setParas(paras) {
    this.ta.value = paras.join("\n\n");
    this.grow();
    this.updateCounts();
    this.changed(true);
  }

  /**
   * Add a paragraph before the first one matching `before` (or, failing that,
   * before the first [CUE BUMPER], which ends the news). Uses the other anchor
   * from whoever read just before, or [ANCHOR 1] with one anchor.
   */
  insertParagraph(body, before, single = false) {
    const paras = this.paras();
    let at = paras.findIndex((p) => before && before.test(p));
    if (at < 0) at = paras.findIndex((p) => /^\s*\[CUE BUMPER\]/i.test(p));
    if (at < 0) at = paras.length;
    const prevTag = paras.slice(0, at).reverse().join("\n").match(/\[ANCHOR (\d)\]/i);
    const anchor = single ? 1 : prevTag && prevTag[1] === "1" ? 2 : 1;
    paras.splice(at, 0, `[ANCHOR ${anchor}]\n${body}`);
    this.setParas(paras);
    return anchor;
  }

  /** Remove the paragraph whose spoken text is exactly `body`. False if it was edited. */
  removeParagraph(body) {
    const paras = this.paras();
    const i = paras.findIndex((p) => p.replace(TAG, "").trim() === body.trim());
    if (i < 0) return false;
    paras.splice(i, 1);
    this.setParas(paras);
    return true;
  }

  /** Swap one paragraph's spoken text for another, keeping its speaker tag. */
  replaceParagraph(oldBody, newBody) {
    const paras = this.paras();
    const i = paras.findIndex((p) => p.replace(TAG, "").trim() === oldBody.trim());
    if (i < 0) return false;
    const tag = paras[i].match(TAG);
    paras[i] = (tag ? tag[0] : "") + newBody;
    this.setParas(paras);
    return true;
  }

  // ---------------------------------------------------------------- display
  grow() {
    this.ta.style.height = "auto";
    this.ta.style.height = this.ta.scrollHeight + 2 + "px";
  }

  updateCounts() {
    const w = spokenWords(this.ta.value);
    this.totalEl.textContent = w ? `${w} words · about ${mmss((w / WPM) * 60)} on camera` : "Empty";
    this.renderTodos();
  }

  /** Re-check the list after names change. */
  refresh() { this.renderTodos(); }

  /** How many things are still open (for the heads-up in Prompt). */
  openItems() {
    return this.todoList();
  }

  todoList() {
    const n = this.names();
    const named = { "ANCHOR 1": n.a1, "ANCHOR 2": n.a2, "WEATHER REPORTER": n.wx };
    const items = todos([{ type: "text", text: this.ta.value }])
      .filter((t) => !(t.kind === "NAME" && named[t.text.toUpperCase().replace(/\s+/g, " ")]));
    // One entry per missing name, not one per mention.
    const seen = new Set();
    return items.filter((t) => {
      const k = t.kind === "NAME" ? "NAME:" + t.text.toUpperCase() : t.kind + t.index;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  renderTodos() {
    const list = this.todoList();
    this.todoEl.replaceChildren();
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "todo-done";
      p.textContent = this.ta.value.trim() ? "Nothing left to fill in." : "";
      this.todoEl.appendChild(p);
      return;
    }
    const h = document.createElement("p");
    h.className = "todo-head";
    h.textContent = `${list.length} thing${list.length === 1 ? "" : "s"} to fill in before recording`;
    this.todoEl.appendChild(h);
    const ul = document.createElement("ul");
    for (const t of list) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = t.kind === "NAME" ? `Who is ${titleCase(t.text)}?` : t.text;
      btn.className = "todo-item todo-" + t.kind.toLowerCase();
      btn.onclick = () => (t.kind === "NAME"
        ? this.root.dispatchEvent(new CustomEvent("need-names", { bubbles: true }))
        : this.reveal(`[${t.text}]`));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    this.todoEl.appendChild(ul);
  }

  /** Select `needle` in the box and scroll so it's in view. */
  reveal(needle) {
    const at = this.ta.value.indexOf(needle);
    if (at < 0) return;
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(at, at + needle.length);
    // Measure where that text sits inside the tall box with a hidden copy.
    const cs = getComputedStyle(this.ta);
    const m = document.createElement("div");
    for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop",
      "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "borderRightWidth", "boxSizing"]) {
      m.style[p] = cs[p];
    }
    Object.assign(m.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap",
      overflowWrap: "break-word", width: this.ta.offsetWidth + "px", borderStyle: "solid" });
    m.textContent = this.ta.value.slice(0, at);
    const mark = document.createElement("span");
    mark.textContent = "|";
    m.appendChild(mark);
    document.body.appendChild(m);
    const y = mark.offsetTop;
    m.remove();
    const scroller = this.root;
    const top = this.ta.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top + y - scroller.clientHeight / 3), behavior: "smooth" });
  }

  changed(now = false) {
    clearTimeout(this.timer);
    const fire = () => this.onChange(this.getText());
    if (now) fire();
    else this.timer = setTimeout(fire, 400);
  }
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
