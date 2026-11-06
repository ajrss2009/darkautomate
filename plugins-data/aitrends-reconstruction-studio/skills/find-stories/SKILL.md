---
name: find-stories
description: "This skill should be used when the user wants ideas or a topic for a reconstruction documentary — e.g. \"find me trending stories\", \"what should my next video be about\", \"find incidents I can reconstruct\", \"give me topic ideas\", \"what's trending this week\", \"I have a topic: …\", \"use this article\", or when the Reconstruction Studio pipeline starts without a chosen story. It searches recent news for incidents that suit a 3D 'what really happened' film (a precise place, a mechanism or sequence, eyewitnesses, official statements, an open question), scores and ranks them, lets the user choose or paste their own, and records the choice."
metadata:
  version: "0.1.0"
  author: aiTrends
---

# Find the story

Goal: a short, ranked list of real, recent stories that make strong reconstructions, then the user's pick (or their own topic) written to the project.

**Read** `references/story-criteria.md` for the scoring rubric, the search recipes and the stories to avoid.

## 1. Ask what kind of search (one question, skip if the user already said)
Use AskUserQuestion:
- **Scope:** last 7 days (default) / last 30 days / evergreen (famous older incidents with new information).
- **Areas** (multi-select, optional): transport and aviation, theme parks and rides, structures and engineering, maritime, sport and events, crime and security, disasters and weather, science and space.
- **Region:** global (default), US, UK/Europe, or another region they name.

The user can instead paste a topic, a headline or links. If they do, skip to step 4 with that topic.

## 2. Search
- Run several WebSearch queries in parallel, following the recipes in the criteria file: recent incident terms × areas × "investigation / statement / witnesses / timeline".
- Use `mode: "extended"` for the last-7-days scope, because fresh news needs it.
- Open the 2–3 strongest articles per candidate with WebFetch to confirm the basics:
  - date and place;
  - what is officially known;
  - whether there are named witnesses and quotes;
  - whether official statements exist;
  - what is still unknown.
- Collect 8–15 raw candidates, then de-duplicate stories that are the same event.

## 3. Score and shortlist
Score each candidate 1–5 on the eight criteria in the rubric, using the stated weights. Drop anything that fails a hard rule (no confirmed facts, active manhunt, the story turns on a minor, rumour only, or graphic footage as the main source). Keep the top 4–6.

Write `research/candidates.md` (in the project folder if one exists, otherwise the workspace root). For each story include:
- the title idea in the house style (e.g. "What Really Happened Inside …", "The … That …");
- a one-line hook;
- date and place;
- the core open question;
- what would be reconstructed in 3D (sets, mechanism);
- source strength (outlets, officials, documents);
- the score breakdown;
- risks (sensitivity, legal, thin sourcing);
- format fit: long-form, short, or both.

## 4. Let the user choose
Show the shortlist compactly: rank, title idea, the hook and the score, one line each. Then call AskUserQuestion with the top 3–4 as options (label = short title, description = hook + score). The automatic "Other" lets them paste their own.

If they paste their own topic, do a quick viability check before accepting it:
- 3–5 searches to confirm it happened and is sourced;
- a list of what can and cannot be reconstructed;
- a score against the rubric.

Then accept it, or explain the weaknesses and ask whether to go ahead anyway.

## 5. Record the choice
Don't create the project here: the make-reconstruction-video skill runs `tools/new_project.py` after asking the format question. Write the files to the project's `research/` folder if one already exists; otherwise write them to the workspace root, and they're moved in later.

Write `research/brief.md` with:
- the chosen story and why;
- the open question;
- 5–10 starting sources (title, outlet, date, URL);
- the provisional title;
- the format, if the user already said (otherwise "TBD": it's asked at the project step);
- known sensitivities: deceased named or not, minors involved, accused person named or not.

Then hand over to the research-story skill.

## Rules
- **Real and recent.** Never invent or embellish a story. Every candidate must link to at least two independent reports, or one official statement.
- **People and harm.** Prefer stories where the open question is about how something happened (a mechanism, a sequence, a system failure) rather than about a private person.
- **Unattended runs:** if the user is away, pick the top-scoring story that has no sensitivity flags, write the brief, and say clearly that this was your pick and why.
