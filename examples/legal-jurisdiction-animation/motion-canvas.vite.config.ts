import ffmpegImport from '@motion-canvas/ffmpeg/lib/server';
import motionCanvasImport from '@motion-canvas/vite-plugin';
import {defineConfig} from 'vite';
import {agentPlugin} from './src/motion-canvas/agent/agent-plugin';

const motionCanvas =
  (motionCanvasImport as unknown as {default?: typeof motionCanvasImport}).default ??
  motionCanvasImport;
const ffmpeg =
  (ffmpegImport as unknown as {default?: typeof ffmpegImport}).default ?? ffmpegImport;

export default defineConfig({
  plugins: [
    motionCanvas({
      project: './src/motion-canvas/project.ts',
      output: '../../output/legal-jurisdiction-animation/motion-canvas',
    }),
    ffmpeg(),
    agentPlugin({
      screenshotDir: '../../output/legal-jurisdiction-animation/motion-canvas/screenshots',
    }),
  ],
  server: {
    host: '127.0.0.1',
  },
});
