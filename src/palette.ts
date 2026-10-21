// One small palette for the whole game. Blue is reserved for things the player can touch.
export const PALETTE = {
  skyTop: 0x161c52,
  skyMid: 0x090b26,
  skyBottom: 0x020208,
  stone: 0x34313d,
  stoneDeep: 0x1b1a22,
  pedestal: 0x23222b,
  vein: 0x55c2ff, // interactive only: hinges, crack rims
  starlight: 0xffd99a, // the star, its beams, revealed grooves, progress veins
  droplet: 0xe4f6ff,
  dropletGlow: 0x9fdcff,
  groove: 0xb0a8d8,
  core: 0xffe7b8,
} as const;
