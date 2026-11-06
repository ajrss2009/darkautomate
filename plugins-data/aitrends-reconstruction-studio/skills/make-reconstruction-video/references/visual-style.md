# Visual style: the reconstruction look

The reference films (which this plugin does not include) were 13–17-minute "what really happened" reconstructions. Every frame was a 3D reconstruction, a typeset evidence card, a map or chart, or (sparingly) a real photo or screenshot. This guide describes that look precisely enough to rebuild it from scratch.

The feeling is **calm, forensic, credible**: museum model, not video game; news graphic, not trailer.

## 1. Two 3D looks (choose per film, can mix by chapter)
### A. White clay ("the model")
- **What:** everything is off-white matte clay: aircraft, cabins, seats, walls and people. The `clay` look: background `#e7e7e5`, soft daylight from top left, strong ambient occlusion in creases, almost no specular.
- **People:** faceless mannequins (`K.mannequin({style:'clay'})`), all identical. One person is singled out by colour: the accent blue `#2f6fdb` (or `warn` red for an aggressor or danger), or by a ring or label. The rest stay white.
- **Detail:** shape carries the information (seat rows, galley carts, the cockpit door, control columns, the instrument panel). Displays and screens are the only saturated colour, and they glow softly (PFD blue/brown, warning amber).
- **Camera:** cutaways are common. Roof off for top-down seat maps, wall off for side views, a "dollhouse" angle into the cockpit. Long, slow pushes. Overhead plans with labels.
- **Best for:** interiors, sequences of who-was-where, sensitive violence (abstraction keeps it respectful), anything where photos don't exist.

### B. Full colour ("the place")
- **What:** a physically lit, believable miniature of the real location: autumn or summer forest, park paths, queue canopies, the ride itself in its real colours (teal track, orange lap bars, red trains), buildings with lit windows at dusk.
- **Looks:** `day` (deep blue sky, warm sun), `golden`, `dusk`, `night` (sodium lamps, glow), `overcast`.
- **People:** still mannequins, but in white or off-white with coloured outfits (staff vests in hi-vis yellow, caps). Riders sit in real poses: arms up, one arm up, gripping the bar.
- **Camera:** crane moves up the lift hill, low angles up at the crest, train-follow cams, POV from the seat, wide aerials over the trees, slow orbits around the station.
- **Best for:** places the audience should recognise, outdoor sequences, scale (height, drop, distance).

**Mixing:** a full-colour film can still drop into clay or the dark `studio` look for a mechanism (ratchet, latch, bolt), or into a dark map. A clay film stays light: maps and charts on light grey, the same blue accent.

## 2. The 2D layer: graphics that sit on top
All overlays are crisp HTML/CSS (`U.*`). The fonts are Inter (UI and headlines), Archivo (heavy titles), IBM Plex Mono (labels, times, footnotes) and Source Serif 4 (article and document body text). Themes are `light` (on clay) and `dark` (on colour and night), picked from the look automatically.

| Device | Use | API |
|---|---|---|
| **Badge** | Small "RECONSTRUCTION" tag, top right, on every 3D shot. Changes to "ILLUSTRATION" for possibility panels. | `cfg.ui.badge` or `badge` per shot |
| **Footnote** | Bottom-left small mono line giving the source of what's on screen or the status of the image: "Seat positions approximate · from passenger accounts (CNN, AP)". On **every** reconstruction and evidence shot. | `footnote` in shots.json, or `U.footnote` |
| **Time chip / stack** | "08:21 SAUDI TIME", "Monday 12 Oct 2026 / after 4 p.m. / the lift hill". Bottom left. On every clock-time beat. | `U.timeChip`, `U.timeStack` |
| **Lower third** | Name and role of a person shown or quoted ("Dr S. M. · passenger, row 14"). | `U.lowerThird` |
| **Pins / tags** | Labels on 3D objects: "CONTROL COLUMN", "ROW 13", "LAP BAR", "TABUK". Small mono caps with a leader line, drawn on the word. | `U.pin` (`tag`, `chip`, `note`, `card`) |
| **Ring / measure** | A circle around a seat or part. A dimension line with "200 ft" or "7 in". | `U.ring`, `U.measure` |
| **Stat** | One big number with a label: "174 / PASSENGERS ON BOARD". The `hero` style is huge and centred ("7700 / GENERAL EMERGENCY"). | `U.stat` |
| **Quote card** | The words of a named source with name, role, outlet and date. `side` adds a photo when an official one exists. A short quote is huge and centred ("“Kill me.”"). | `U.quote`, `U.statement` |
| **List** | Numbered or bullet stack: "Official statements / Flight-tracking data / First-hand accounts"; "Scenario 1, 2". | `U.list` |
| **Compare** | "OPERATOR A → OPERATOR B", before → after. | `U.compare` |
| **Chart** | An altitude or speed line drawn over time, with an aircraft marker and labelled points ("lost 2,000 ft in 4 min"). Light grid, mono ticks. | `U.chart` |
| **Article** | A news article excerpt, re-typeset or screenshotted. A yellow highlighter sweeps across the exact words as the narrator reads them. Slow zoom. | `U.article`, `U.screenshot` |
| **Document** | A filing, report or patent page, with highlights and redaction bars. | `U.document`, `U.screenshot` |
| **Phone card** | "VIRAL VIDEO" with a play icon and one line of description: the film describes the clip instead of showing it. | `U.phone` |
| **Photo** | A real photo full-frame with a Ken Burns move, a name pill or caption, and a credit at the bottom right. | `U.photo` |
| **Possibility panels** | Three side-by-side stills (`U.triptych`) labelled "Possibility 1 of 3 · not a finding". Used when the cause is unknown. | render clean stills into the project with `--stills t1,t2,t3 --noui --out assets/stills`, then `U.triptych` |
| **Statement wall** | Left-aligned black text on light grey: the current status in 2–4 short lines ("No formal charge announced. Not officially named.") | `U.statement` |
| **Captions** | Optional. Default off for 16:9 and on for 9:16, with karaoke word highlight. | `config.captions` |

**Typography rules.**
- Labels and tags are mono caps with 0.06–0.12 em tracking. Headlines are Inter 700–800, sentence case. Numbers are tabular.
- Never more than about 12 words of text on screen except for an article or document excerpt.
- Text never fights the 3D. Use the scrim (`U.scrim`) under text placed on busy colour shots.

**Colour rules.**
- One accent per film: blue `#2f6fdb` by default. Red (`warn`) only for danger, alarms and the aggressor. Yellow only as the highlighter.
- On clay everything else is greys.
- On colour shots the place's real colours dominate and the UI stays white or black.

## 3. Shot grammar (what the films actually cut between)
- **Openers:** the place in full colour, or the clay model, at the moment before. A slow move, a time stack, and a stat ("174 passengers").
- **Establish → detail → reaction:** wide set → close-up of the mechanism or person → the evidence card that proves it.
- **Every claim gets a source shot:** within about 10 s of a factual claim, show its source (article highlight, document, quote card, or footnote on the reconstruction).
- **Evidence follows the voice:** the highlighter starts on the first quoted word (`info.w('phrase')`) and ends as the phrase ends.
- **Maps** for every change of place or scale:
  - dark map with glowing dots for "where else" and counts;
  - light map with a blue route and black tags for journeys;
  - the route grows as the narration moves.
- **Charts** for any number that changes over time (altitude, speed, count).
- **Mechanisms** get their own explainer: a dark studio or clay close-up, parts labelled one by one, motion shown slowly (bar opening, pawl skipping), then "what it should do" vs "what investigators say happened".
- **Unknowns** become possibility panels or statement walls, never invented footage.
- **Aftermath:** people as mannequins (paramedics in hi-vis, staff at the station), a closed ride with a sign, the empty seat with a ring. Officials appear as quote cards, or as photos when an official photo exists.
- **Endings:** a slow pull-out of the full model, or of the place at dusk, with the last line. Then the status wall.

## 4. Pacing (measured from the reference films)
- **Median shot 3–4 s** in long-form: 2–3 s cuts in action beats, 5–8 s holds on slow 3D moves and articles. Shorts: 1.8–2.5 s.
- **A new visual idea at least every 20 s:** set, angle, card type or map.
- **Never more than 3 consecutive shots of the same type** (three article highlights in a row is the limit).
- **Every shot moves:** a camera dolly, orbit or push, a Ken Burns move on photos, a zoom on documents. Nothing is static except for a 0.3–0.5 s hold when a card lands.
- **Transitions:**
  - hard cuts by default;
  - `dip` (to black, 0.5 s) at chapter changes;
  - `dipWhite` or `flash` for a jolt (impact, the moment of failure), at most 3–5 per film.

## 5. Accuracy and ethics on screen
- **Label it.** Reconstructions are labelled (the badge, plus footnotes like "positions approximate", "based on passenger accounts", "not to scale").
- **Unknowns stay unknown.** Never show something the sources don't support as if it were known: use panels marked "not a finding".
- **Violence and injuries are abstracted.** Clay figures, camera turned away, cut before contact, a red ring on a floor. No blood, no gore, no faces of the injured or dead unless the family or officials released the image and it is essential.
- **Victims:** victims and private witnesses are shown only by name, role and quote, unless their own published photo is used with care. Children are never identified.
- **Accused people:** show their exact legal status ("arrested · not charged as of 15 Oct"). No mugshots unless officially released, and never styled as "the villain".
- **Photos and screenshots carry credits,** and every real asset is logged (`media-sourcing.md`).

## 6. 9:16 shorts
- **Stage and safe area:** the stage is 1080×1920. Keep subjects in the middle 60%, cards in the upper-middle, captions in the lower third (y ≈ 1350–1650). Nothing important in the top 180 px or bottom 260 px.
- **Pacing:** cuts every 1.8–2.5 s. One idea per shot. Bigger type: stats about 1.4× larger.
- **Hook:** open on the most surprising frame (the empty seat, the open bar, the number), with the question as a caption-sized title within 1.5 s.
- **Captions:** on with karaoke highlight. End on the status line, plus a loop-friendly last frame.

## 7. Don'ts
- Don't make the 3D look like a game: no neon outlines, no lens flares, no chromatic aberration, no shaky cam beyond a subtle handheld float (`cam.handheld`, about 0.02).
- **Avoid generic stock imagery.** Every image must be about this story, or an honest reconstruction.
- **No text walls.** Keep cards to about 12 words. Don't use more than 3 type sizes on one card.
- **No fake UI.** Don't fake real outlets' pages. Re-typeset excerpts carry "Excerpt re-typeset · source: Outlet, date". Screenshots must be real captures.
- **No AI-generated faces.** Don't use AI-generated faces or photoreal people.
