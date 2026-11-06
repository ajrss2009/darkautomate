# Research protocol

## Source tiers
| Tier | What | Use |
|---|---|---|
| T1 official | Investigating agency, police, regulator, prosecutor, operator or manufacturer statement, court filing, inspection report, patent, published data (flight tracking from the provider itself) | Facts of record; quote exactly; "according to …" |
| T2 major outlet | Wire services (AP, Reuters, AFP), national broadcasters and papers with named reporters | Facts with attribution; eyewitness interviews they conducted |
| T3 local / specialist | Local TV/radio/papers, trade and specialist sites (aviation, rides, engineering), expert interviews | Eyewitnesses, technical context; attribute by outlet |
| T4 social / UGC | Posts and videos by witnesses or unknown accounts | Only to say what was posted, never as fact; never the sole source |

**Two-source rule:** central facts need T1, or two independent T2/T3 sources. Note an outlet that is only citing another outlet ("citing ABC News") as such.

## Files (all in `research/`)
**ledger.md** — one row per atomic fact:
```
| ID | Fact (one claim) | Value/units | Source (outlet, author, date) | Tier | URL | Notes/conflicts |
| F014 | Train is 9 cars, one row of 4 seats each | 36 riders | Park ride page; Coaster DB | T1/T3 | … | — |
```

**timeline.md** — local clock time, event, source ID(s), confidence:
```
08:21 (Saudi, UTC+3) — first officer attacks the captain (per UAE prosecutor) — F031 — official claim
08:24 — level at ~15,000 ft (AP analysis of tracking data) — F035 — T2 analysis
```
Give the time zone once. Convert to speakable times later in the script.

**quotes.md** — verbatim, with speaker, role, how it was given (interview, statement, post) and the outlet, date and URL:
```
Q07 "We saw mechanics and paramedics running down there." — Ben E., rider on the stopped train — told <outlet>, 13 Oct — URL
```

**people.md** — name, role, what they did, and the naming decision:
- **Use:** named by an official body or by themselves in public.
- **Withhold:** minors; suspects no authority has named; private people who asked not to be named.
- **Role only:** "a dentist travelling home", when the name adds nothing.

**unknowns.md** — every open question that matters, who holds the answer, and the exact wording of any non-answer:
```
U03 Where on the track he left the train — police have not said — Cobb County PD statement 13 Oct
```

**precedents.md** — comparable cases: place, year, what happened, official finding (with source), and how the case is similar to and different from this one. Keep the firewall clear: a precedent is context, never evidence about this event.

**reconstruction_brief.md** — what the 3D needs, set by set:
- **Place / vehicle / ride:**
  - the model and its key dimensions: length, height, gauge, seat pitch, door positions, lift height, drop angle, car count;
  - layout and orientation;
  - surroundings (trees, buildings, terrain, water);
  - colours (livery, track, seats);
  - time of day and weather at the time.
- **Mechanism:** the parts and how they move (lap bar pivot, ratchet, pawl, door lock, control column linkage), with diagrams, patents or manuals cited.
- **People positions:** who was where, at which moment, with source IDs. Mark anything approximate.
- **Camera opportunities:** a list of 10–20 shots the facts support (e.g. "low angle at the lift crest", "top-down cutaway of the cockpit", "over-the-shoulder at the door").
- **Approximations:** what is unknown and how the 3D will treat it, e.g. "car number not published → train shown without numbering"; "exact path unpublished → track drawn as indicative with footnote".

**media.md** — candidate real media:
- **Article moments** to show highlighted, with the exact phrases.
- **Documents and pages.**
- **Photos:** location, people officials have released, the vehicle or ride.
- **Maps.**
- **Video stills:** only with a clear basis.

For each, record the source URL, the owner, and the basis (see below). Captured files go to `assets/…` and get a row in `media_log.csv` via `tools/media_log.py`.

**sources.md** — the bibliography: tier, outlet, title, author, date, URL, accessed date. It also feeds the video description.

## Media basis (record one per item; this is not legal advice — the user decides)
- **Own work:** engine renders, typeset recreations of short quotes with the outlet credited.
- **Public domain / government works** (e.g. many US federal agency images), with the source.
- **Openly licensed** (Creative Commons): record the licence, version, author and required credit.
- **Handout / press photos:** released by police, families or companies for media use; note the terms.
- **News screenshot for commentary:** a short excerpt shown while it is discussed, credited on screen. Flag for the user's fair-use / fair-dealing review.
- **Avoid:**
  - photos of private individuals without a release or official publication;
  - graphic images;
  - anything a family asked not to be shared;
  - paywalled content copied in full.

## Respect rules that research must enforce
- **Family wishes:** record any request (e.g. "don't share videos of his final moments") in `people.md`. The video honours it, and the script can say so.
- **Minors:** never collect identifying details about minors involved.
- **Accused people:** keep the official status exact and current (arrested? charged? named?), with a date.
