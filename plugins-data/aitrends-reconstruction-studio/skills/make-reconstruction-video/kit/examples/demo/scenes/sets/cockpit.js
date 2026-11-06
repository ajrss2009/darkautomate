// Demo set: white clay cockpit (narrow-body), captain seated at the yoke, first officer seat empty, door closed.
import { registerSet, K } from '/engine/api.js';
registerSet('cockpit', async (W) => {
  W.shadowArea([0.3, 1, 0], 4); W.noFog();
  const ck = K.cockpit({ doorOpen: 0 });
  W.add(ck.group);
  const cap = K.mannequin({ style: 'clay', pose: 'pilot' });
  cap.position.copy(ck.capSeat); cap.rotation.y = Math.PI / 2; W.add(cap);        // mannequin faces +Z -> rotate to face +X (forward)
  const fo = K.mannequin({ style: 'clay', pose: 'pilot' }); fo.position.copy(ck.foSeat); fo.rotation.y = Math.PI / 2; W.add(fo);
  W.add(K.ground({ color: '#e7e7e5', y: -0.09, size: 60 }));
  return { ck, cap, fo };
});
