import { registerShot } from '/engine/api.js';
registerShot('s11', { look: 'clay', ui(U, t, info) { U.stat({ kicker: 'Transponder', value: '7700', label: 'General emergency', sub: 'squawk code · demo' }, { style: 'hero', at: info.w('seven', 0.6) - 0.1 }); } });
