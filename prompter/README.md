# RGN Prompter

A teleprompter that follows the anchors' voices: the script moves as they read,
holds when they pause or ad-lib, and catches up if they skip ahead.

Live at (once GitHub Pages is on): `https://kh84949vnj-ui.github.io/redgold-news/prompter/`

## Privacy

With the default **On this device** engine, speech recognition runs inside the
browser (Vosk, compiled to WebAssembly). Audio never leaves the computer or
iPad, nothing is recorded or saved, and after the first visit it works with
Wi-Fi off. The model (about 40 MB) is downloaded once from this site and kept
on the device.

The other engine, **Browser speech service**, uses Safari's or Chrome's
built-in recognizer, which may send audio to Apple or Google. Only use it if
the district has approved that.

## Using it

The start page asks **What are you recording?** and offers three scripts.
Each is saved separately on the device and has its own **Edit** and
**Prompt** views (tap **RGN Prompter** at the top to go back to the start):

- **News rundown**: the anchors' script (open, school news, close), drafted
  each week. Weather appears in it only as a `[CUE WEATHER]` card.
- **Weather**: just the forecast read for the weather reporter, drafted each
  week.
- **Custom**: starts blank for anything else (student voices intros, promos,
  standalone segments).

The start page shows each one's state (draft ready, edited, newer draft
available). Direct links work too: `…/prompter/#news`, `#weather`, `#custom`.

### Edit

1. Open the prompter in **Safari** (Mac or iPad) and pick a script. This
   week's draft is already there; the weekly run
   (`python -m rgn.weekly --publish`) publishes it and the page loads it.
2. The whole script is one box. `[ANCHOR 1]` lines are speakers, `[CUE …]`
   lines are cues, and notes like `[VERIFY: location]` sit inside sentences.
   The top shows the word count and about how long it reads on camera.
3. **Who's on air**: type the anchors' (and weather reporter's) names once.
   They fill in on the prompter and in copies; the script keeps the
   placeholders, and the names stay on that device (they're never published).
4. The checklist lists what's still open: names, `[VERIFY]`, `[ADD]`,
   `[SIMPLIFY]` and flagged topics. Click one to jump to it in the script.
5. Edits save on the device as you type. **More** has Copy for Google Doc,
   Download .txt, Paste a script and Start over from this week's draft.
6. When a newer draft comes out, a script nobody edited updates by itself.
   An edited one shows a gold banner: **Load it** (replaces your edits) or
   **Keep mine**.

### One or two anchors (News rundown)

The **Two anchors** checkbox at the top of the News rundown editor switches
the script between two anchors (the default) and one. With one anchor, every
`[ANCHOR 2]` and `[BOTH]` part goes to `[ANCHOR 1]`, the handoffs ("Thanks,
[ANCHOR 1].") and the second introduction are dropped, and the stories read as
one continuous run. The choice is remembered on the device, so next week's
draft arrives the same way. An untouched draft switches back and forth
cleanly; an edited script can go to one anchor with the edits kept, but going
back to two needs **Start over from this week's draft**.

### School board items (News rundown)

When the school board meets during the episode week, the News rundown editor
shows a **School board this week** panel with the posted agenda. Check an item
to add a plain-English line to the news block ("The school board meets
Wednesday at 6 p.m. One thing on the agenda is whether to approve…"); later
items say "The board will also look at…". Uncheck to take the line back out.
Items marked *student interest* are shown first (untick the filter to see all),
flagged items (personnel, safety and similar) can't be added, and long items
get a `[SIMPLIFY]` note so a student puts them in their own words. If the
agenda isn't posted yet, there's an option to just mention the meeting.

### Updating the draft

**Update this week's draft** (start page, or **More** in the editor) opens the
GitHub page that runs the weekly update: click **Run workflow** there. In about
two minutes the new draft appears in the prompter by itself (or as the gold
banner, if the script was edited). The same update also runs on its own every
Friday at 6:47 AM and Sunday at 6:47 PM Central
(`.github/workflows/weekly.yml`). Board items picked on the Story Desk are
only added when Claude runs the update; otherwise use the board panel in the
News rundown editor.

### Prompt

The prompter shows real names and hides notes like `[VERIFY]` (turn them on
under **Settings → Show notes**). If anything is still open, a bar says so with
a **Back to Edit** button. Follow voice / Steady scroll, the talent screen
(Mac only, for Sidecar) and Full screen are in **Settings**.

1. Click **Start listening** and allow the microphone. The first time, the
   speech model (about 40 MB) takes a few seconds to load.
2. Read. The status pill shows **Following** when it knows where you are,
   **Listening, not sure where** when it's holding still (ad-lib, or it lost
   track), and **Waiting for speech** during pauses.

At a `[CUE …]` card, the prompter parks on the card during the package and
picks up when the next anchor starts the next block.

### Controls

| Key / action | What it does |
|---|---|
| Space | Pause or resume following |
| ↓ / → / Page Down (clicker "next") | Jump forward one line |
| ↑ / ← / Page Up (clicker "back") | Jump back one line |
| Click a word (operator screen) | Jump there; following continues from that word |
| Home | Back to the top |
| M | Mirror (for beam-splitter glass) |
| + / − | Text size |
| F | Full screen |

**Steady scroll** mode scrolls at a fixed speed instead of following voices
(the Settings speed slider sets it).

### Two screens: MacBook + iPad (Sidecar)

1. Connect the iPad to the MacBook with Sidecar (Control Center → Screen
   Mirroring → the iPad), preferably with a USB-C cable.
2. In the prompter on the Mac, click **Talent screen**. A second window opens
   with just the script; drag it onto the iPad and press **F** (or double-tap)
   for full screen.
3. Run the mic and controls from the Mac window. The talent window follows it.

Sidecar needs both devices signed in to the same Apple ID, and district device
management can turn it off. If it's not available, the iPad can run the
prompter by itself: open the page in Safari on the iPad, load the script,
start listening, and use **Full screen**.

### Microphone

A lav or USB mic on the computer running the prompter works far better than a
built-in mic across the room. Pick it under **Settings → Microphone**. If the
anchors share one mic, the prompter follows whoever is reading; it tracks the
words, not the voice.

## How it follows (for whoever maintains it)

- `js/text.js`: parses the script and turns written words into how they're
  said (`77` → "seventy seven", `6:30` → "six thirty", `November 23` →
  "november twenty third", `RedWolves` → "red wolves", `ISD` → "i s d").
- `js/align.js`: matches the last ~10 heard words to the script around the
  current spot (local sequence alignment, with sound-alike and half-word
  matching). It only moves on an unbroken run of matched words that includes
  a meaningful word; jumps further ahead need longer runs and a second
  confirming update. Running ahead of the reader is the failure it guards
  against hardest.
- `js/motion.js`: measures the reader's pace and keeps the text moving smoothly
  between recognizer updates (at most 2 words ahead of the last confirmed
  word, never past a cue card, only while someone is talking), then eases the
  scroll with a critically damped spring.
- With **Listen only for words in the script** on (default), Vosk is limited to
  the script's vocabulary, which makes recognition of those words much more
  accurate.

### Tests

```bash
cd prompter
node --test tests/*.test.js      # unit tests + simulated reads
node tests/bench.js 40           # full accuracy table across noise levels and scenarios
```

The simulated reads cover clean, typical and noisy recognition, skipped
sentences and paragraphs, re-read lines and ad-libs, with the word list on and
off.
