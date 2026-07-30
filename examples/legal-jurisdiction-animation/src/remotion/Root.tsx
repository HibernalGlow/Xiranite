import {Composition} from 'remotion';
import {LegalJurisdiction} from './LegalJurisdiction';
import {DURATION_FRAMES, FPS} from './storyboard';

export const RemotionRoot = () => (
  <Composition
    id="LegalJurisdiction"
    component={LegalJurisdiction}
    durationInFrames={DURATION_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
