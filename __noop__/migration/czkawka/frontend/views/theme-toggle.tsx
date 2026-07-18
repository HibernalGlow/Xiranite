import { useAtomValue, useSetAtom } from 'jotai';
import { Moon, Sun, TvMinimal } from 'lucide-react';
import { useEffect } from 'react';
import { themeAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import {
  applyMatchMediaAtom,
  initThemeAtom,
  toggleThemeAtom,
} from '@/nodes/czkawka/upstream/atom/theme';
import { TooltipButton } from '@/nodes/czkawka/upstream/components';
import { ButtonProps } from '@/components/ui/button';
import { DARK_MODE_MEDIA, Theme } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';

export function ThemeToggle(props: ButtonProps) {
  const theme = useAtomValue(themeAtom);
  const initTheme = useSetAtom(initThemeAtom);
  const toggleTheme = useSetAtom(toggleThemeAtom);
  const applyMatchMedia = useSetAtom(applyMatchMediaAtom);
  const t = useT();

  useEffect(() => {
    initTheme();
    const mql = window.matchMedia(DARK_MODE_MEDIA);
    applyMatchMedia(mql.matches);
    const listener = (e: MediaQueryListEvent) => {
      applyMatchMedia(e.matches);
    };
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, []);

  return (
    <TooltipButton tooltip={t('Toggle theme')} onClick={toggleTheme} {...props}>
      {theme.display === Theme.Light && <Sun className="h-4 w-4" />}
      {theme.display === Theme.Dark && <Moon className="h-4 w-4" />}
      {theme.display === Theme.System && <TvMinimal className="h-4 w-4" />}
    </TooltipButton>
  );
}
