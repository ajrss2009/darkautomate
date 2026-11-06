---
name: research-story
description: "This skill should be used when a reconstruction documentary needs its research done — e.g. \"research this story\", \"dig into the incident\", \"build the timeline\", \"find the sources\", \"what do we know about …\", \"get the technical details for the 3D\", \"find photos/articles/documents for the video\", or when the Reconstruction Studio pipeline reaches the research stage. It produces a sourced fact ledger, timeline, quotes bank, people list, known/unknown list, precedents, a reconstruction brief with dimensions and layouts for the 3D sets, and a media list with the source and licence of each item."
metadata:
  version: "0.1.0"
  author: aiTrends
---

# Research the story (deeply, with sources)

Every sentence in the film must be traceable to a source, and the 3D has to be built from real dimensions and layouts. This stage produces both.

**Read** `references/research-protocol.md`: source tiers, file formats, the reconstruction brief and the media rules.

## Steps
1. **Start from `research/brief.md`.** If it's missing, make one from the user's topic.
   - Write the open question at the top of `research/dossier.md`, then work outward from it.
2. **Broad sweep, in parallel.** Run 10–20 WebSearch queries:
   - the incident with "timeline", "what we know", "witness", "statement", "investigation";
   - each named official body;
   - each witness name;
   - the vehicle/ride/building model and its specifications;
   - the mechanism (patents, manuals, regulator guidance);
   - precedents ("similar incident" plus the mechanism).
   - Use extended mode for anything from the last two weeks.
3. **Read the primary material.** Use WebFetch on the strongest 15–30 pages: official statements and press releases first, then wire services and major outlets, then local outlets with eyewitness interviews, then specialist outlets.
   - Prefer each outlet's own report over aggregators.
   - When the subagent tool is available and the story is large, split reading by thread (timeline, people, mechanism, precedents, aftermath) across parallel agents. Each returns ledger rows with URLs. Merge and de-duplicate the rows yourself.
4. **Write the research files** (formats in the protocol):
   - `ledger.md`: numbered facts F001… with source tier and URL;
   - `timeline.md`: clock times;
   - `quotes.md`: verbatim, with speaker, outlet and date;
   - `people.md`: naming rules applied;
   - `unknowns.md`;
   - `precedents.md`;
   - `reconstruction_brief.md`: the 3D sets, dimensions, layouts, colours and what is approximate;
   - `media.md`: candidate photos, articles, documents and videos, with source and licence basis;
   - `sources.md`: the bibliography.
5. **Cross-check.**
   - Every central fact needs two independent sources, or one official source.
   - Where accounts conflict, record both with sources and mark the conflict. The script will say "accounts differ".
   - Re-check all numbers (heights, speeds, counts, times) against the best source, and convert units once, in the ledger.
6. **Capture evidence.** Do this for the 3–8 article or document moments the script is likely to quote:
   - Articles: `node tools/capture_article.mjs --url … --out projects/<slug>/assets/articles/<name>.png --phrases "exact quoted words"`.
   - PDFs: `python tools/doc_page.py --pdf … --page N --phrases "…" --out projects/<slug>/assets/docs/<name>.png`.
   - Log each one with `python tools/media_log.py add …`.
   - If a site blocks automated capture, note it. The shot can re-typeset the excerpt with U.article instead, quoting the outlet.
7. **Summarise for the user** in 8–12 lines:
   - the core facts;
   - the central unknown;
   - the strongest quotes, with speaker names;
   - what the 3D will show;
   - any sensitivity decisions (names withheld, family wishes);
   - any weak spots (thin sourcing, conflicts).

   Continue to the script stage unless they redirect.

## Rules
- **Don't invent.** Never fill gaps with plausible detail. If the exact seat, minute or wording isn't published, it goes in `unknowns.md` and the script says so.
- **Dated facts.** Developing stories change daily. Each ledger fact carries its publication date, and the status wrap in the script uses the latest one ("As of Thursday 15 October…"). Re-check the newest reports right before the script is approved and again before the voiceover.
- **Quotes are verbatim.** Copy them exactly from the source text. If two outlets transcribe a quote differently, use the official or original-language version, or the outlet that recorded it, and note the variant.
- **Logins and paywalls.** Don't bypass logins or paywalls. Use what is publicly readable, or ask the user to provide an article they have access to.
- **Logging media.** Images and screenshots of real people and outlets are logged with their basis, as described in the protocol. When the basis is weak (a copyrighted photo with no licence), list it as "needs user decision" and plan a 3D or typeset alternative.
