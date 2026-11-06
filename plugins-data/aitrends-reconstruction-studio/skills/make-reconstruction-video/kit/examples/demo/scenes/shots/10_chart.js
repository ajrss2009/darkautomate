// s10 — altitude chart drawing itself, with the drop annotated
import { registerShot } from '/engine/api.js';
const P = []; for (let i = 0; i <= 120; i++) { const x = i / 4; const y = x < 9 ? 34000 + Math.sin(x * 1.3) * 300 : x < 12 ? 34000 - (x - 9) / 3 * 19000 + Math.sin(x * 3) * 200 : 15000 + Math.sin(x) * 150; P.push([x, y]); }
registerShot('s10', {
  look: 'clay',
  ui(U, t, info) {
    U.chart({ points: P, title: 'Altitude · flight tracking (demo data)', x: { min: 0, max: 30, ticks: [[0, '08:20'], [10, '08:21'], [20, '08:22'], [30, '08:23']] }, y: { min: 10000, max: 38000, ticks: [[15000, '15,000'], [25000, '25,000'], [35000, '35,000']] },
      marker: 'plane', annotations: [{ x: 12, y: 15000, text: '> 14,000 ft in under a minute', at: info.w('falls', 2.4) + 0.6 }] }, { drawFrom: 0.2, drawTo: info.dur - 0.8 });
    U.footnote('Tracking data: example · profile approximate');
  },
});
