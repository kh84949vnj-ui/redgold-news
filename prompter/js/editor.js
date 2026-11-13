// Edit view: the script as the episode rundown, one box per written block.
import { splitScript, joinScript, nameBlocks, todos } from "./segments.js";

const WPM = 150;
const spokenWords = (t) => (t.replace(/\[[^\]]*\]/g, " ").match(/[A-Za-z0-9][\w'’.-]*/g) || []).length;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export class Editor {
  /**
   * @param {HTMLElement} root  container for the rundown
   * @param {object} opts  { onChange(text), onCheck(todos) }
   */
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.list = root.querySelector(".rundown");
    this.todoEl = root.querySelector(".todo");
    this.totalEl = root.querySelector(".total");
    this.onChange = onChange || (() => {});
    this.blocks = [];
    this.timer = null;
  }

  setText(text) {
    this.blocks = nameBlocks(splitScript(text));
    // A blank script still gets one box to type in.
    if (!this.blocks.length) this.blocks = [{ type: "text", text: "", name: "Your script" }];
    this.render();
  }

  getText() { return joinScript(this.blocks); }

  /**
   * Add a paragraph to a block, before the first paragraph matching `before`
   * (or before the block's last paragraph, which is usually a toss).
   * Returns the anchor number used, so the caller can remember the text.
   */
  insertParagraph(name, body, before, single = false) {
    const b = this.blocks.find((x) => x.name === name);
    if (!b) return false;
    const paras = b.text.split(/\n{2,}/);
    let at = paras.findIndex((p) => before && before.test(p));
    if (at < 0) at = paras.length > 1 ? paras.length - 1 : paras.length;
    // Use the other anchor from the one who read just before this spot.
    const prevTag = paras.slice(0, at).reverse().join("\n").match(/\[ANCHOR (\d)\]/i);
    const anchor = single ? 1 : prevTag && prevTag[1] === "1" ? 2 : 1;
    paras.splice(at, 0, `[ANCHOR ${anchor}]\n${body}`);
    b.text = paras.join("\n\n");
    this.render();
    this.changed(true);
    return anchor;
  }

  /** Remove the paragraph whose spoken text is exactly `body`. False if it was edited. */
  removeParagraph(name, body) {
    const b = this.blocks.find((x) => x.name === name);
    if (!b) return false;
    const paras = b.text.split(/\n{2,}/);
    const i = paras.findIndex((p) => p.replace(/^\s*\[ANCHOR \d\]\s*\n/i, "").trim() === body.trim());
    if (i < 0) return false;
    paras.splice(i, 1);
    b.text = paras.join("\n\n");
    this.render();
    this.changed(true);
    return true;
  }

  /** Swap one paragraph's spoken text for another, keeping its speaker tag. */
  replaceParagraph(name, oldBody, newBody) {
    const b = this.blocks.find((x) => x.name === name);
    if (!b) return false;
    const paras = b.text.split(/\n{2,}/);
    const i = paras.findIndex((p) => p.replace(/^\s*\[ANCHOR \d\]\s*\n/i, "").trim() === oldBody.trim());
    if (i < 0) return false;
    const tag = paras[i].match(/^\s*\[ANCHOR \d\]\s*\n/i);
    paras[i] = (tag ? tag[0] : "") + newBody;
    b.text = paras.join("\n\n");
    this.render();
    this.changed(true);
    return true;
  }

  /** Replace the Weather block's text (keeps everything else as edited). */
  replaceBlock(name, text) {
    const b = this.blocks.find((x) => x.name === name);
    if (!b) return false;
    b.text = text;
    this.render();
    this.changed(true);
    return true;
  }

  render() {
    this.list.replaceChildren();
    let n = 0;
    this.blocks.forEach((b, i) => {
      n++;
      const li = document.createElement("li");
      li.className = "blk " + (b.type === "cue" ? "blk-cue" : "blk-text");
      const num = document.createElement("span");
      num.className = "blk-n";
      num.textContent = n;
      li.appendChild(num);
      const body = document.createElement("div");
      body.className = "blk-body";
      const head = document.createElement("div");
      head.className = "blk-head";
      const h = document.createElement("h3");
      h.textContent = b.name;
      head.appendChild(h);
      if (b.type === "cue") {
        const cue = document.createElement("span");
        cue.className = "blk-cue-text";
        cue.textContent = `[${b.text}]`;
        head.appendChild(cue);
        body.appendChild(head);
      } else {
        const time = document.createElement("span");
        time.className = "blk-time";
        time.id = "blk-time-" + i;
        head.appendChild(time);
        body.appendChild(head);
        const ta = document.createElement("textarea");
        ta.id = "blk-" + i;
        ta.spellcheck = true;
        ta.value = b.text;
        ta.setAttribute("aria-label", b.name);
        if (!b.text) ta.placeholder = "Type or paste your script here. Put a speaker on its own line in brackets, like [ANCHOR 1], and a cue like [CUE PACKAGE].";
        ta.addEventListener("input", () => {
          b.text = ta.value;
          this.grow(ta);
          this.updateCounts();
          this.changed();
        });
        body.appendChild(ta);
      }
      li.appendChild(body);
      this.list.appendChild(li);
    });
    requestAnimationFrame(() => this.list.querySelectorAll("textarea").forEach((t) => this.grow(t)));
    this.updateCounts();
  }

  grow(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + 2 + "px";
  }

  updateCounts() {
    let total = 0;
    this.blocks.forEach((b, i) => {
      if (b.type !== "text") return;
      const w = spokenWords(b.text);
      const notes = /notes$/i.test(b.name);
      if (!notes) total += (w / WPM) * 60;
      const el = document.getElementById("blk-time-" + i);
      if (el) el.textContent = notes ? "not read on air" : w ? `${w} words · ${mmss((w / WPM) * 60)}` : "empty";
    });
    this.totalEl.textContent = `On-camera reading time ${mmss(total)} (at ${WPM} words a minute)`;
    this.renderTodos();
  }

  renderTodos() {
    const items = todos(this.blocks);
    this.todoEl.replaceChildren();
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "todo-done";
      p.textContent = "Nothing left to fill in.";
      this.todoEl.appendChild(p);
      return;
    }
    const h = document.createElement("p");
    h.className = "todo-head";
    h.textContent = `${items.length} thing${items.length === 1 ? "" : "s"} to fill in before recording`;
    this.todoEl.appendChild(h);
    const ul = document.createElement("ul");
    for (const t of items) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      const label = t.kind === "NAME" ? `Name for ${t.text}` : t.kind === "FLAGGED" ? t.text : t.text;
      btn.textContent = `${label} · ${this.blocks[t.block].name}`;
      btn.className = "todo-item todo-" + t.kind.toLowerCase();
      btn.onclick = () => {
        const ta = document.getElementById("blk-" + t.block);
        if (!ta) return;
        ta.focus();
        // Re-find the text in case it moved since the list was drawn.
        const at = ta.value.indexOf(`[${t.text}]`);
        if (at >= 0) ta.setSelectionRange(at, at + t.length);
        ta.scrollIntoView({ block: "center", behavior: "smooth" });
      };
      li.appendChild(btn);
      ul.appendChild(li);
    }
    this.todoEl.appendChild(ul);
  }

  changed(now = false) {
    clearTimeout(this.timer);
    const fire = () => this.onChange(this.getText());
    if (now) fire();
    else this.timer = setTimeout(fire, 400);
  }
}
