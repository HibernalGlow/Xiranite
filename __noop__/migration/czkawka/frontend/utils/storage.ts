import { Theme } from '@/nodes/czkawka/upstream/consts';
import type { CustomThemeConfig, RuntimeThemePayload } from '@/nodes/czkawka/upstream/types';

const THEME_KEY = 'theme';
const LANG_KEY = 'language';
const THEME_NAME_KEY = 'theme-name';
const RUNTIME_THEME_KEY = 'runtime-theme';
const CUSTOM_THEMES_KEY = 'custom-themes';

export const storage = {
  getTheme(): string {
    const str = localStorage.getItem(THEME_KEY);
    if (!str || !Object.values<string>(Theme).includes(str)) {
      return Theme.System;
    }
    return str;
  },

  setTheme(theme: string) {
    localStorage.setItem(THEME_KEY, theme);
  },

  getLanguage(): string {
    return localStorage.getItem(LANG_KEY) || 'en';
  },

  setLanguage(v: string) {
    localStorage.setItem(LANG_KEY, v);
  },

  // 主题名称
  getThemeName(): string {
    return localStorage.getItem(THEME_NAME_KEY) || 'Default';
  },

  setThemeName(name: string) {
    localStorage.setItem(THEME_NAME_KEY, name);
  },

  // 运行时主题配置
  getRuntimeTheme(): RuntimeThemePayload | null {
    try {
      const stored = localStorage.getItem(RUNTIME_THEME_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as RuntimeThemePayload;
      if (
        !parsed ||
        !parsed.themes ||
        !parsed.themes.light ||
        !parsed.themes.dark
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  setRuntimeTheme(payload: RuntimeThemePayload) {
    localStorage.setItem(RUNTIME_THEME_KEY, JSON.stringify(payload));
  },

  // 自定义主题列表
  getCustomThemes(): CustomThemeConfig[] {
    try {
      const stored = localStorage.getItem(CUSTOM_THEMES_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed as CustomThemeConfig[];
    } catch {
      return [];
    }
  },

  setCustomThemes(themes: CustomThemeConfig[]) {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  },

  // 自定义背景图片 (base64)
  getBackgroundImage(): string | null {
    return localStorage.getItem('background-image');
  },

  setBackgroundImage(image: string | null) {
    if (image) {
      localStorage.setItem('background-image', image);
    } else {
      localStorage.removeItem('background-image');
    }
  },

  // 背景透明度 (0-100)
  getBackgroundOpacity(): number {
    const val = localStorage.getItem('background-opacity');
    if (val === null) return 100;
    const num = parseInt(val, 10);
    return isNaN(num) ? 100 : Math.max(0, Math.min(100, num));
  },

  setBackgroundOpacity(opacity: number) {
    localStorage.setItem('background-opacity', String(opacity));
  },

  // 背景模糊度 (0-20)
  getBackgroundBlur(): number {
    const val = localStorage.getItem('background-blur');
    if (val === null) return 8;
    const num = parseInt(val, 10);
    return isNaN(num) ? 8 : Math.max(0, Math.min(20, num));
  },

  setBackgroundBlur(blur: number) {
    localStorage.setItem('background-blur', String(blur));
  },

  // 遮罩透明度 (0-100)
  getMaskOpacity(): number {
    const val = localStorage.getItem('mask-opacity');
    if (val === null) return 80;
    const num = parseInt(val, 10);
    return isNaN(num) ? 80 : Math.max(0, Math.min(100, num));
  },

  setMaskOpacity(opacity: number) {
    localStorage.setItem('mask-opacity', String(opacity));
  },

  // 是否启用背景图片
  getBackgroundEnabled(): boolean {
    const val = localStorage.getItem('background-enabled');
    return val !== 'false'; // 默认为 true
  },

  setBackgroundEnabled(enabled: boolean) {
    localStorage.setItem('background-enabled', String(enabled));
  },
};
