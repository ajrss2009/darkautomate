# Shot planning: from the timed narration to `story/shots.json`

Input:
- `timeline/words.json` (from transcribe.py);
- the approved script, with its `[visual notes]`;
- `research/reconstruction_brief.md` and `media.md`.

Output:
- `story/bible.md`;
- `story/shots.json`;
- `story/shot_plan.md`, the human-readable table you show the user.

## 1. Draft beats
Run `python tools/beats.py --project projects/<slug>`. It cuts the narration into phrase beats and writes a draft `shots.json`. Use `--force` to overwrite.
- Long-form defaults are max 7 s and min 1.6 s; shorts are 4.5 s and 1.1 s.
- Every beat already has `start`, `end` and `line`, and the shots are contiguous.

## 2. Story bible (`story/bible.md`, about one page)
- **Look per chapter:** clay or colour, plus which preset (day, dusk and so on), and why.
- **Sets:** one line each, with the source of its layout (ledger IDs) and what is approximate. Usually 4–9 sets:
  - the main place (exterior);
  - the main interior;
  - a mechanism studio;
  - one or two maps;
  - secondary places (precedents, the hospital exterior, the courthouse) as simpler sets or photos.
- **Cast:** each person as a mannequin, with a colour rule (who is accent blue, who is warn red, staff in hi-vis) and a naming rule (from `people.md`).
- **Recurring motifs:** e.g. the empty seat with a ring, the lap bar orange, the door handle, the blue route line, the clock chip format.
- **Evidence list:** which articles, documents and quotes appear, and where.
- **Music plan:** a mood per chapter. It seeds the film's score (compose-music skill).

## 3. Rewrite shots.json (the real plan)
Work through the draft in order, chapter by chapter. For each shot write a concrete `scene`: `<set>: <camera move>; <action>; <overlays>`. Merge, split and re-time as needed.

**Coverage rules:**
- **Concrete narration gets the literal picture.** "The first officer reached for the axe" → the cockpit set, a close-up of the crash axe bracket with a ring callout, the mannequin's hand reaching.
- **Abstract narration gets evidence or a graphic.** Use a quote card, statement wall, list, chart, map or article highlight, never a random 3D angle.
- **Every factual claim gets a source shot within about 10 s:** the article or document highlight timed to the phrase, a quote card, or the footnote on the reconstruction.
- **Numbers become a stat, chart or measure** on the word itself: `at: info.w('two hundred')`.
- **Clock times get a time chip or time stack.** First mention of a place gets a map or a place tag. First appearance of a person gets a lower third, or a role label if they aren't named.
- **Unknowns get possibility panels** ("Possibility 1 of 3 · not a finding"), a statement wall, or the 3D frozen with a question tag. Never invented footage.
- **Chapter starts** get `in: {type: 'dip', dur: 0.6}` and an establishing wide shot of the new place.
- **Jolts** (the moment of failure, the alarm, the impact) get a `flash` or `dipWhite`. Use 3–5 per film at most.

**Timing rules:**
- **Cut points:** cut 0.10–0.20 s before the first word of the phrase. Never cut in the middle of a word.
- **Shot length:** median 3–4 s. Action is 2–3 s. Slow reconstruction moves and article reads are 5–8 s. Nothing over 9 s without an internal change (a reveal, a highlight, a pin).
- **Variety:** at most 3 consecutive shots of the same kind. Alternate wide, close, card and map. Keep screen direction consistent within a sequence (an aircraft flying left to right stays left to right).
- **Silence:** music-only beats (pauses over 0.8 s) can hold a reveal or let a card breathe. Don't cut on silence for no reason.
- **The last shot** ends at `duration`, the audio end. Fade out over 0.8–1.2 s.

**Footnotes** (`footnote` field) go on every reconstruction and evidence shot. Keep them short and specific:
- "Seat map approximate · from passenger accounts (AP, CNN)"
- "Track geometry approximate · park ride data"
- "Excerpt re-typeset · source: FOX 5 Atlanta, 13 Oct 2026"
- "Illustration · not a finding"

**Sound cues** go in each shot as `sfx` / `amb` (see `sound-design.md`).

## 4. The plan table (`story/shot_plan.md`), shown to the user
| # | time | line (short) | picture | evidence/source |
|---|---|---|---|---|
| s014 | 1:12–1:16 | "At 8:21, …" | cockpit wide, door closed, time chip 08:21 | prosecutor statement F031 |

Send the user a 6–10 line summary:
- the number of shots;
- the sets to be built;
- the look per chapter;
- where the real media appears;
- anything approximated.

Continue unless they object. The preview is their real checkpoint.

## 5. Shorts (9:16) from a long film
- **Make it a separate project:** new_project.py `--format short`, its own approved script and voiceover.
- **Reuse the sets:** copy `scenes/sets/*.js` and change the cameras for vertical, using `V()` for fov and positions (`V(36, 52)`).
- **About 25–40 shots for 60–90 s.** Put the hook frame first, cards larger and captions on.
