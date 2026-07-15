import { DARK_MODE_MEDIA } from '@/nodes/czkawka/upstream/consts';

export function isSystemDark() {
  return window.matchMedia(DARK_MODE_MEDIA).matches;
}
