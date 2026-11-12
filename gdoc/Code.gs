/**
 * Red Gold News: lets the weekly prep script write into this Google Doc.
 *
 * It only ever replaces the text between the two marker lines below.
 * Everything else in the doc is left alone. If the markers are missing,
 * the block is added at the end of the doc.
 *
 * Setup (once): see gdoc/README.md. Run setupToken() one time, then
 * Deploy > New deployment > Web app.
 */
const START_MARK = '▼ RGN WEEKLY (written automatically, edits between these lines get replaced) ▼';
const END_MARK = '▲ END RGN WEEKLY ▲';

function setupToken() {
  // Shared password the prep script sends with every update. Paste the
  // RGN_GDOC_TOKEN value from .env below, run this once, then change it back to
  // the placeholder so the password never sits in the code.
  PropertiesService.getScriptProperties().setProperty('RGN_TOKEN', 'PASTE_TOKEN_FROM_.env_HERE');
  Logger.log('Token saved. You can deploy now.');
}

function doGet() {
  return json_({ ok: true, service: 'rgn-doc-writer' });
}

function doPost(e) {
  const lock = LockService.getDocumentLock();
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('RGN_TOKEN');
    if (!token || token.indexOf('PASTE_TOKEN') === 0 || body.token !== token) return json_({ ok: false, error: 'bad token' });
    lock.waitLock(20000);
    const n = writeBlock_(body.lines || []);
    return json_({ ok: true, paragraphs: n, doc: DocumentApp.getActiveDocument().getName() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function textOf_(el) {
  const T = DocumentApp.ElementType;
  if (el.getType() === T.PARAGRAPH) return el.asParagraph().getText();
  if (el.getType() === T.LIST_ITEM) return el.asListItem().getText();
  return '';
}

function style_(p, text, kind) {
  const t = p.editAsText();
  if (!text) return;
  t.setForegroundColor('#000000');
  t.setFontSize(kind === 'mark' ? 9 : 12);
  t.setItalic(kind === 'mark');
  // Speaker tags and cues like [BOTH] or [CUE BUMPER] are bold, like the rest of the doc.
  t.setBold(kind === 'tag' || /^\[.*\]$/.test(text.trim()));
}

function writeBlock_(lines) {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  let start = -1, end = -1;
  for (let i = 0; i < body.getNumChildren(); i++) {
    const t = textOf_(body.getChild(i)).trim();
    if (t === START_MARK && start < 0) start = i;
    else if (t === END_MARK && start >= 0) { end = i; break; }
  }
  if (start < 0 || end < 0) {
    body.appendParagraph('');
    const s = body.appendParagraph(START_MARK); style_(s, START_MARK, 'mark');
    const en = body.appendParagraph(END_MARK); style_(en, END_MARK, 'mark');
    start = body.getChildIndex(s);
    end = body.getChildIndex(en);
  }
  for (let i = end - 1; i > start; i--) body.removeChild(body.getChild(i));
  let at = start + 1;
  lines.forEach(function (line) {
    const text = typeof line === 'string' ? line : line.text;
    const kind = typeof line === 'string' ? '' : (line.kind || '');
    const p = body.insertParagraph(at++, text);
    p.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    style_(p, text, kind);
  });
  doc.saveAndClose();
  return lines.length;
}
