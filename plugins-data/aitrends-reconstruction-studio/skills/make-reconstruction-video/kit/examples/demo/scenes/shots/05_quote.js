// s05 — quote card on the light background
import { registerShot } from '/engine/api.js';
registerShot('s05', { look: 'clay', ui(U, t, info) { U.quote({ text: 'You always expect to get back.', who: 'Rider in the queue', role: 'interview, Oct. 12', tag: 'witness' }, { at: 0.2 }); } });
