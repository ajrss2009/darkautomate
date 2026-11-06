import { registerShot } from '/engine/api.js';
registerShot('s15', { ui(U, t, info) { U.photo({ src: '/project/assets/photo_wide.jpg', caption: { kicker: 'Oct. 12, 2026', title: 'The lift hill, demo still' }, credit: 'Image: engine render (demo)' }, { kb: [[0, 1.05, 0.5, 0.5], [info.dur, 1.16, 0.56, 0.44]] }); } });
