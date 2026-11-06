---
name: write-script
description: "This skill should be used when the user wants the narration script for a reconstruction documentary written, rewritten, shortened, checked or approved — e.g. \"write the script\", \"turn the research into a script\", \"make it 12 minutes\", \"write a 60-second short version\", \"here is my script, use it\", \"check my script\", \"make it sound less AI\", or when the Reconstruction Studio pipeline reaches the script stage. It writes in the calm, forensic 'what really happened' house style (cold open, 'This is the story of…' litany, method line, clock-time chronology, sourced quotes, stated unknowns, dated status wrap, quiet ending), lints it, and gets explicit user approval before any voiceover."
metadata:
  version: "0.1.0"
  author: aiTrends
---

# Write the narration (or adopt the user's)

The script is the spine of the video: every shot is timed to its words. Write it from the research dossier, never from memory, and get the user's explicit approval before any voice is generated.

**Read first:** `references/script-style.md` (the voice, the measured numbers, the devices, the ethics) and `references/script-structure.md` (templates, files, a worked example, how to handle a pasted script). The studio tools live in the workspace install of the kit (`reconstruction-studio/` — see `../make-reconstruction-video/references/install.md`).

## Inputs
- `research/dossier.md`, `research/ledger.md` (numbered facts with sources), `research/quotes.md`, `research/timeline.md` from the research-story skill. If they are missing, run that skill first, or ask the user to paste the material they want to use.
- From `config.json`: the format (`long`, 16:9, 12–18 min, or `short`, 9:16, 60–90 s) and any target length the user gave.
- Optional extras the user asked for: a sponsor read, a membership/newsletter line, a channel sign-off.

## Path A — Claude writes it
1. **Outline:** write `script/outline.md` following the structure table in the style guide (§7).
   - For each part, list the ledger IDs and quotes it will use.
   - List the planted objects and where each pays off.
   - Choose the central question and the 4–6 litany items.
   - Long-form: show the outline to the user in 8–12 lines and continue unless they object. Shorts skip this.
2. **Draft:** write `script/script_v01.md` with `## Chapter` headings and `[visual notes]` lines.
   - Hit the length: about 150 wpm for long-form (12 min ≈ 1,800 words, 16 min ≈ 2,400), about 175 wpm for shorts.
   - Write numbers and times as they are spoken.
   - Every factual sentence must trace to a ledger ID. Record the mapping in `script/sources_in_script.md`.
3. **Lint:** run `python tools/script_lint.py projects/<slug>/script/script_v01.md --format long|short`.
   - Fix every FAIL and as many WARNs as make sense.
   - Then do the self-check in style guide §9.
   - Run the `humanizer` skill's checks mentally if it is installed. Do not let it rewrite quotes.
4. **Present for approval.**
   - Send the full script, readable: chapters, with visual notes visibly marked.
   - For long scripts, send `script_v01.md` as a file and include the cold open and litany inline.
   - State the version, the word count, the estimated runtime, the lint result, and any names deliberately withheld (and why).
   - Ask plainly: **approve, or what to change?**
5. **Revise** into v02, v03 and so on until the user approves. Never overwrite an earlier version.
6. **On approval** run `python tools/script_export.py --project projects/<slug> --from script/script_vNN.md --approved "<the user's words>"`.
   - It writes `script_final.txt`, `synthesis.txt` and `SCRIPT_APPROVAL.md`.
   - Then edit `synthesis.txt` for pronunciation only. Respell names, codes and acronyms (e.g. "A6-FKF" → "A six, F K F") while keeping the word count the same where you can.
   - When a new version is exported, `synthesis.txt` is rebuilt from it automatically (the old one is kept as `synthesis_prev_*.txt`), so re-apply the respellings. The voice tools refuse to run on a stale or unapproved script.

## Path B — the user pastes or uploads their own script
- **Keep their words.** Clean only obvious transcription errors and punctuation that would mislead a voice.
  - If the `aitrends-script` skill is installed and the text is a raw transcript, use it for the clean-up.
- **Add `[visual notes]`** so the shot plan can follow the script.
- **Lint and report.** FAILs are suggestions here.
  - Point out unsourced claims, names that should be withheld and hype, and offer fixes.
  - Change wording only where the user agrees.
- **Approve and export** exactly as in Path A, steps 4–6.

## Rules
- **No voice without approval.** No voiceover sample of the script, no full narration and no timing-dependent shots until `SCRIPT_APPROVAL.md` exists for the current version.
  - A voice test using neutral text is fine.
- **A changed script needs fresh approval.** Any change after approval means a new version and a new approval. If narration already exists, it must be regenerated (or the edit confined to the synthesis respellings).
- **Shorts from a long video:** shorts cut from an approved long script are new scripts and need their own approval.
- **Keep sources separable.** Quotes are verbatim, with the source and date in `sources_in_script.md`; this lets the user verify fast.
- **Unattended runs:** if the user is away, write and lint the script, save it, and stop at the approval gate with a clear summary. Never self-approve.
