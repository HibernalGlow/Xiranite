import {Composition} from 'remotion';
import {LegalJurisdiction} from './LegalJurisdiction';
import {DURATION_SECONDS, FPS} from './storyboard';

export const RemotionRoot = () => (
  <Composition
    id="LegalJurisdiction"
    component={LegalJurisdiction}
    durationInFrames={DURATION_SECONDS * FPS}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
