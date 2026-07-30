export const FPS = 60;
export const DURATION_SECONDS = 26;

export const SCENES = {
  definition: {start: 0, duration: 168},
  scope: {start: 168, duration: 222},
  relations: {start: 390, duration: 120},
  mediation: {start: 510, duration: 330},
  arbitration: {start: 840, duration: 240},
  labor: {start: 1080, duration: 240},
  recap: {start: 1320, duration: 240},
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
  gold: '#D4A32E',
  goldSoft: '#F7EFD6',
  blue: '#3768A5',
  blueSoft: '#E4ECF7',
} as const;

export type Accent = 'red' | 'teal' | 'gold' | 'blue';

export const accentColor = (accent: Accent) => PALETTE[accent];

export const accentSoftColor = (accent: Accent) => PALETTE[`${accent}Soft`];
