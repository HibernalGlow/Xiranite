import { atom } from 'jotai';
import { getDefaultSettings } from '@/nodes/czkawka/upstream/consts';
import type { Settings } from '@/nodes/czkawka/upstream/types';
import { presetsAtom } from './primitive';

export const settingsAtom = atom(
  (get) => {
    const presets = get(presetsAtom);
    return (
      presets.find((preset) => preset.active)?.settings || getDefaultSettings()
    );
  },
  (get, set, updater: (v: Settings) => Settings) => {
    const presets = get(presetsAtom);
    set(
      presetsAtom,
      presets.map((preset) => {
        if (preset.active) {
          return {
            ...preset,
            settings: updater(preset.settings),
            changed: true,
          };
        }
        return preset;
      }),
    );
  },
);
