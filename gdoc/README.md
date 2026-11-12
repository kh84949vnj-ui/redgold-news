# Writing into the weekly Google Doc

`Code.gs` is a small Apps Script that lives inside the weekly script doc. The
prep script sends it the week's block (weather read, menu read, the menu for
Canva and news leads) and it writes that block between two marker lines:

    ▼ RGN WEEKLY (written automatically, edits between these lines get replaced) ▼
    ...this week's block...
    ▲ END RGN WEEKLY ▲

Everything outside the markers is never touched. The first time, the markers
are added at the bottom of the doc. Move them anywhere you like and later runs
will write in that spot.

## Setup (once, about 5 minutes)

1. Open the weekly doc. Go to **Extensions → Apps Script**.
2. Delete what's in `Code.gs` and paste in this folder's `Code.gs`. Save.
3. In `setupToken()`, replace `PASTE_TOKEN_FROM_.env_HERE` with the
   `RGN_GDOC_TOKEN` value from your `.env`. Then pick **setupToken** in the
   function menu at the top and click **Run**. Afterwards, put the placeholder
   back so the password isn't left in the code (it stays saved in the
   script's properties).
   Approve the permissions prompt (it asks to edit this doc).
4. Click **Deploy → New deployment**. Pick type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
5. Put that URL in `.env` as `RGN_GDOC_URL=`.

"Anyone" is needed because the prep script isn't signed in to Google. The
token is what keeps other people from writing to the doc: the web app refuses
any request without it. If the district's Google settings don't offer
"Anyone", ask tech whether web apps can be published for this doc.

## Weekly

    python -m rgn.weekly --gdoc

or, to preview without writing:

    python -m rgn.gdoc --dry-run

If you ever change `Code.gs`, use **Deploy → Manage deployments → Edit →
New version** so the URL stays the same.

## Changing the token

Make a new random value (for example `python3 -c "import secrets; print(secrets.token_urlsafe(24))"`),
put it in `.env`, paste it into `setupToken()`, run it, and put the placeholder back.
