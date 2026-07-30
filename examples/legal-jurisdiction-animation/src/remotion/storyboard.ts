export const FPS = 60;
export const PLAYBACK_RATE = 0.6;
export const SOURCE_DURATION_SECONDS = 26;

const toPlaybackFrames = (sourceFrames: number) => Math.round(sourceFrames / PLAYBACK_RATE);
const slowScene = (start: number, duration: number) => ({
  start: toPlaybackFrames(start),
  duration: toPlaybackFrames(duration),
});

export const DURATION_FRAMES = toPlaybackFrames(SOURCE_DURATION_SECONDS * FPS);
export const DURATION_SECONDS = DURATION_FRAMES / FPS;
export const toSourceFrame = (playbackFrame: number) => playbackFrame * PLAYBACK_RATE;

export const SCENES = {
  definition: slowScene(0, 168),
  scope: slowScene(168, 222),
  relations: slowScene(390, 120),
  mediation: slowScene(510, 330),
  arbitration: slowScene(840, 240),
  labor: slowScene(1080, 240),
  recap: slowScene(1320, 240),
} as const;

export const PALETTE = {
  background: '#F3F5F2',
  paper: '#FFFFFF',
  ink: '#17201D',
  muted: '#66716C',
  line: '#CBD2CE',
  red: '#C83F35',
  redSoft: '#F7E5E2',
  teal: '#087C73',
  tealSoft: '#DFF0EC',
  gold: '#A8791D',
  goldSoft: '#F7EFD6',
  blue: '#3768A5',
  blueSoft: '#E4ECF7',
} as const;

export type Accent = 'red' | 'teal' | 'gold' | 'blue';

export const accentColor = (accent: Accent) => PALETTE[accent];

export const accentSoftColor = (accent: Accent) => PALETTE[`${accent}Soft`];
