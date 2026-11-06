// Demo set: clay airliner in a pale void with a soft floor far below to catch its shadow.
import { registerSet, K } from '/engine/api.js';
registerSet('sky', async (W) => {
  W.shadowArea([20, -8, 0], 40);
  const plane = K.airliner({ length: 39.5 });
  W.add(plane);
  W.add(K.ground({ color: '#e4e4e2', y: -14, size: 3000 }));
  return { plane };
});
