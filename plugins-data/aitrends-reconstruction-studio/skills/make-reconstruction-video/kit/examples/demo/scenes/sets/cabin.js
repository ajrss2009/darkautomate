// Demo set: white clay cabin, 31 rows 3+3, passengers seated, cockpit door at the front (+X).
import { registerSet, K } from '/engine/api.js';
registerSet('cabin', async (W) => {
  W.shadowArea([14, 1, 0], 16); W.fogScale(0.2);
  const cb = K.cabin({ rows: 31, passengers: 0.94, seed: 3 });
  W.add(cb.group);
  return { cb };
});
