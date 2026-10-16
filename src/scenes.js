// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// Open, close, stop, a position and a slat tilt are already Gladys scene
// actions on the blind's features. This one runs what only the motor knows:
// the favorite position stored in it (with the Motion remote or app).
//
// The trigger (`moved_outside_gladys`) is fired by the hub (src/hub.js),
// never as a consequence of this action: a command from Gladys is not
// "outside Gladys", so a scene bound to it cannot loop.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async go_favorite(hub, { fields }) {
    await hub.goFavorite(fields.device);
  },
};
