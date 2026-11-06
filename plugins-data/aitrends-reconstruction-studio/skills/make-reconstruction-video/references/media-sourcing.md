# Real media: the mix, the source log, and the rules

The user chose **a mix with a source log**:
- reconstructions and typeset cards carry most of the film;
- real photos, article screenshots and document pages appear where they add proof or recognition;
- every third-party item is logged with its source and the basis for using it.

*This is practical guidance, not legal advice. Fair use and fair dealing depend on the user's country and the use. Flag borderline items for the user to decide.*

## Target mix (long-form)
| Share of shots | Type |
|---|---|
| 60–75% | 3D reconstruction (clay or colour) |
| 15–25% | Typeset cards: quotes, stats, lists, statements, charts, maps, re-typeset article excerpts |
| 5–15% | Real media: article/document screenshots with highlights, official or handout photos, location photos with a clear licence |

Shorts lean even more on 3D and cards. A single screenshot or photo is enough.

## Where real media earns its place
- **Proof of reporting:** the outlet's article with the exact quoted sentence highlighted, as it is read.
- **Official records:** a filing, inspection report, patent, regulator page or press release, with the key sentence highlighted.
- **Recognition:** the real place (the park entrance, the airport, the ride sign), when a licensed photo exists.
- **People officials or families released photos of,** shown respectfully with a name pill and credit.

## Capturing
- **Web pages:** `node tools/capture_article.mjs --url URL --out projects/<slug>/assets/articles/<name>.png --phrases "phrase one|phrase two"`.
  - It writes the PNG plus a `.json` with phrase boxes for `U.screenshot`.
  - If capture is blocked (paywall, bot wall, cookie wall that won't close): don't bypass it. Use `U.article` (a re-typeset excerpt of the short quoted passage, with the outlet credited), or ask the user for a screenshot they took themselves.
- **PDFs:** `python tools/doc_page.py --pdf … --page N --phrases "…" --out …png`.
- **Photos:** `python tools/media_log.py fetch --project … --url … --out assets/photos/x.jpg --owner … --basis … --credit …`.
  - Use it only for images with a clear basis: public domain, government work, Creative Commons, or official handouts for media use.
  - Prefer Wikimedia Commons and agency or press-room pages, where the licence is stated on the page.

## The source log (`research/media_log.csv`, via `tools/media_log.py`)
Every real item gets a row: file, URL, owner, basis, credit line, shots used in, notes.

**Basis values** (pick the most accurate one):
- `public domain (US federal government work)`, `public domain (age)`;
- `CC BY 4.0`, `CC BY-SA 4.0` (+ author, as required);
- `official handout for media use (terms: …)`;
- `own capture of public web page: news screenshot for commentary (fair use review)`;
- `own capture of public document (court filing / report)`;
- `licensed by user` (they provided it with rights);
- `needs user decision` (anything uncertain).

`python tools/media_log.py list --project …` prints a credits block for the video description.

## On-screen credit rules
- **Screenshots and articles:** a footnote with outlet and date ("Source: FOX 5 Atlanta · 13 Oct 2026"). Re-typeset excerpts add "excerpt re-typeset".
- **Photos:** credit at the bottom right ("Photo: Name / Agency · CC BY 4.0"), plus a name pill for people.
- **Documents:** "Source: <agency>, <document title>, p. N".

## Don't
- **No full-article reproduction.** Show a short excerpt, only while it's being discussed.
- **No video clips or TV footage** from news broadcasts. Describe them instead with `U.phone` ("Viral video · shows …").
- **Nothing private or harmful:** no photos of private individuals (witnesses, passengers, minors) unless they or officials published them for media use and they're essential; no graphic or injury images; nothing a family asked not to be shared.
- **No faked UI or brands.** Never fake a real outlet's page, or put words in a real person's mouth. Re-typeset only verbatim text.
- **No AI images of real people or places presented as real.**

## Before delivery
1. Run `media_log.py list` and check every real asset used in `shots.json` has a row and a basis.
2. List all `needs user decision` items for the user, with a 3D or typeset alternative already prepared for each.
3. Put the credits block in `out/description.txt`.
