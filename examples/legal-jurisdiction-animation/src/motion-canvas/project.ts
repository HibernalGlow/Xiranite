import {makeProject} from '@motion-canvas/core';
import {agentClient} from './agent/agent-client';
import legalJurisdiction from './scenes/legal-jurisdiction?scene';

export default makeProject({
  name: 'motion-canvas',
  plugins: [agentClient()],
  scenes: [legalJurisdiction],
});
