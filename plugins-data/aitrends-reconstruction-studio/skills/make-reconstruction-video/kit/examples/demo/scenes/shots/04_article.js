// s04 — article excerpt (re-typeset), highlighter sweeps on the quoted phrase as it is spoken
import { registerShot } from '/engine/api.js';
registerShot('s04', {
  bg: '#0d0f12',
  ui(U, t, info) {
    U.article({ outlet: 'Example News', color: '#c8102e', headline: 'What we know about the coaster incident', byline: 'Staff reporter', date: 'Updated Oct. 13, 2026',
      paragraphs: ['A rider waiting in line said one car came back with an empty seat. Its safety bar, she said, looked loose when the car came back into the station.', 'Officials have not said what caused the incident.'],
      highlights: ['looked loose when the car came back'] },
      { hlAt: [info.w('loose', 1.2) - 0.35], zoom: [[0, 0.92, 750, 470], [info.dur, 1.1, 760, 560]] });
    U.footnote('Excerpt re-typeset for illustration · source: Example News');
  },
});
