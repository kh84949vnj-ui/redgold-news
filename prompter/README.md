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

1. Open the prompter page in **Safari** (Mac or iPad). This week's script is
   already there: the weekly prep run (`python -m rgn.weekly --publish`)
   publishes the draft, and the page loads it.
2. The script is laid out as the episode rundown: anchor open, intro cue,
   news block, bumper, weather, bumper, student voices, menu, close, outro.
   Each written block is a text box with its reading time; cues are cards.
3. The box at the top lists what still needs filling in: anchor names
   (`[ANCHOR 1]`), `[VERIFY: …]` and `[ADD: …]` notes, and flagged topics for
   the adviser. Click one to jump to it.
4. Edits save on that device as you type. **Copy for Google Doc** and
   **Download .txt** take the finished script anywhere else.
5. When the prep run publishes a newer draft (next week's, or a fresher
   forecast), a script nobody has edited updates by itself. An edited one
   shows a **Load the newer draft** button instead of replacing the work.
   Because news and weather are separate, a new forecast only touches the
   Weather script. **Start over from this week's draft** (or **Clear** for
   Custom) throws away edits; it asks twice.

### Prompt

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
