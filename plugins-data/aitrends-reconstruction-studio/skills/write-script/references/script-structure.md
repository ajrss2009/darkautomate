# Script templates, files and a worked example

## Files the script stage writes (inside the project folder)
| File | Contents |
|---|---|
| `script/outline.md` | Chapter plan: each part from the style guide with the facts (ledger IDs) and quotes it will use, plus the planted objects and where they pay off |
| `script/script_v01.md` (v02, …) | Readable script: `## Chapter` headings, `[visual notes]` on their own lines, spoken paragraphs. Revisions bump the version |
| `script/script_final.txt` | Written only after approval. Exactly the spoken words, plain text, one paragraph per line group, no headings or notes. Whisper aligns to this |
| `script/synthesis.txt` | Same words as `script_final.txt`, with phonetic respellings for the voice only: names, codes, numbers the voice gets wrong. Word count must match where possible |
| `script/SCRIPT_APPROVAL.md` | Version approved, date and time, the user's words, the sha256 of `script_final.txt` |
| `script/sources_in_script.md` | Every factual sentence → ledger ID(s) → source(s). Lets the user spot-check |

Make `script_final.txt` with `python tools/script_export.py --project projects/<slug> --from script/script_v02.md --approved "<user's words>"` (strips headings and notes, records the approval).

## Long-form template (fill every slot; delete none without a reason)
```
## Cold open
[opener visual]
<PLACE/ALTITUDE LINE>. <IDENTITY FRAGMENT: vehicle / ride / building>.
<NUMBER FRAGMENT>. <SECOND NUMBER FRAGMENT>.
In <precise spot>, <named ordinary person> is <doing something ordinary> with <who>.
And then, <he/she> says, <first sign of trouble, in their words>.
<2–5 short lines escalating, each concrete, one more named witness quote>
<What the outside saw: a screen, a queue, a tracking line>.
Nobody <in the place> knows why. <The answer is / What is known starts with> <object>.

## The story of
This is the story of <event name>.
Of <plant 1: an object built for safety>. <And a twist line>.
Of <person with a surprising role>. <Another person in one fragment>.
And <final image: the empty seat / the unheld controls / the closed rides>.
<Central question>? <Second question>?
<Method line: what the film is built on; it is a reconstruction; where sources disagree we say so>.
[optional one-line CTA]
<Roadmap: Start in/at …. Then …>.

## Setting
<Day, date. Place.> <Departure / opening time>.
<Vehicle or ride explained in 3–6 lines: type, age, layout, the safety system that matters>.
<People: role + one fact each, attributed>. <Plant: "Remember them." / "Hold on to that.">
<A calm stretch: "For two hours, nothing happens.">

## The event
<"Nobody outside that cockpit saw what happened in it. So what follows is a reconstruction, built from …">
<Clock time>. <Positions>.
<Minute-by-minute, each beat attributed: "According to …", "the tracking data shows …">
<Explainer just before it matters (3–6 lines)>
<Stated unknowns: "Whether it sounded on this flight has not been published.">
<Witness quotes in sequence; the rescue or the turning point>
<Scale line: how far, how fast, how long>.

## Aftermath
<Outside world: emergency codes, closures, calls, jets, statements — each with its source>
<Landing / evacuation / rescue with times>. <Casualties as officially stated>.
<Human detail from the ground: a video, a gesture, a meeting>.
<Bridge: "Everyone is alive. But one question is now bigger than all the others.">

## The investigation
<Pivot question>.
<How each authority characterises it, in their words, cautious → strong>.
<Background reporting with named outlets; what each claims; who hasn't responded>.
<If mechanism: "That leaves, broadly, three ways…" then One/Two/Three each with a precedent (place, year header → 6–12 lines → official finding → firewall line)>.

## Where it stands
Here is where it stands on <weekday, date>. / As of <date>, …
<What is known (3–5 lines)>. <What isn't (2–4 lines)>. <Where the answers sit: agencies, records, recordings>.
<Presumption of innocence when anyone is accused>. <What happens next and when, if scheduled>.

## Ending
<Return to a person: what they did after; what someone said about them>.
<Close on their own words, or on the opening image restated.>
```

## Short-form template (9:16)
```
<PLACE/ALTITUDE LINE>. <IDENTITY>.
<Event in 4–6 short lines, with one quote>.
<Central question>?
<Most important known fact>. <Most important unknown>.
As of <date>, <status in one line>.
<Close on a quote or the opening image.>
```

## Worked example — fictional, for technique only
*(Fictional incident: a cable car stops over a river gorge. All names, places and facts are invented.)*

```
## Cold open
[3D colour: wide over the gorge at dusk, cabin small on the cable; time stack]
Ninety metres above the Arda gorge. Cabin six of the Valtor cable car.
Thirty-one passengers. One operator in the station.
In the downhill corner, Mira Halse is riding with her father.
And then, she says, the cabin just stops. No bump. No sound.
[3D: inside the cabin, mannequins at the windows; lower third MIRA HALSE · PASSENGER]
The lights stay on. The cabin swings, slowly, and settles.
Below them, the river. Above them, one cable.
In the valley station, a screen shows every cabin as a green dot. Cabin six turns amber.
Nobody in the cabin knows why. The answer is in a box on the station wall.

## The story of
This is the story of cabin six.
Of a brake built to stop a line in under a second. And a line that stopped without being asked.
Of a retired engineer who knew the sound a gearbox makes. A pilot who flew in at night.
And thirty-one people who waited four hours ninety metres up.
Why did the line stop? And why did it take four hours to get them down?
This film is built on the operator's statement, the regional inspector's first report, and the words of the people in the cabin. Where those disagree, we'll say so.
Start in the valley station, with a green screen. Then the cabin, minute by minute.
```
What the example demonstrates:
- **Opening:** a place-and-height opener, an identity fragment, then numbers.
- **Witness:** a named passenger in a precise spot, with her words introduced by "she says".
- **Mystery line:** a concrete object holds the answer.
- **Litany:** four items, ending on an image, then two central questions.
- **Method line, then roadmap.**
- **Style:** no adjectives of fear, and every line can be pictured.

## Adapting a script the user pastes
- **Keep their wording.**
  - Fix only spelling, transcription errors and punctuation that misleads the voice.
  - Flag, rather than rewrite, unsourced claims, names that should not be used (style guide §6) and hype words.
- **Add `[visual notes]`** so the shot plan can follow it. Ask before adding or removing whole sentences.
- **Then lint it, and treat FAILs as suggestions.** Report them to the user; the words stay the user's unless they say otherwise.
- **If the user's script already has timestamps** (SRT/VTT/`[mm:ss]`), keep them only as a guide. The real timings come from Whisper on the final voiceover.
