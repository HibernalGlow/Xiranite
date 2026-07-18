import { atomWithStorage } from 'jotai/utils';
import type { Settings } from '@/nodes/czkawka/upstream/types';

export type SimilarImagesPresetConfig = Pick<
  Settings,
  | 'similarImagesSubHashSize'
  | 'similarImagesSubHashAlg'
  | 'similarImagesSubResizeAlgorithm'
  | 'similarImagesSubSimilarity'
  | 'similarImagesSubIgnoreSameSize'
  | 'similarImagesFolderThreshold'
>;

export interface SimilarImagesUserPreset {
  id: string;
  name: string;
  config: SimilarImagesPresetConfig;
}

export const similarImagesPresetsAtom = atomWithStorage<
  SimilarImagesUserPreset[]
>('similar-images-user-presets', [], undefined, { getOnInit: true });
