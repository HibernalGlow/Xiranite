import { isTauri } from '@/nodes/czkawka/upstream/adapters/tauri-core';
import { getCurrentWebviewWindow } from '@/nodes/czkawka/upstream/adapters/tauri-webview-window';
import { atom } from 'jotai';
import { Theme } from '@/nodes/czkawka/upstream/consts';
import type { CustomThemeConfig } from '@/nodes/czkawka/upstream/types';
import { storage } from '@/nodes/czkawka/upstream/utils/storage';
import { isSystemDark } from '@/nodes/czkawka/upstream/utils/theme';
import { applyThemeColors, PRESET_THEMES } from '@/nodes/czkawka/upstream/utils/themeManager';
import {
  backgroundBlurAtom,
  backgroundEnabledAtom,
  backgroundImageAtom,
  backgroundOpacityAtom,
  customThemesAtom,
  maskOpacityAtom,
  selectedThemeAtom,
  themeAtom,
} from './primitive';

function setTheme(theme: string) {
  if (!isTauri()) {
    return;
  }
  const ww = getCurrentWebviewWindow();
  if (theme === Theme.Light || theme === Theme.Dark) {
    ww.setTheme(theme);
  } else {
    ww.setTheme(null);
  }
}

function applyTheme(theme: string) {
  let finalTheme = theme;
  if (theme === Theme.System) {
    finalTheme = isSystemDark() ? Theme.Dark : Theme.Light;
  }
  const root = window.document.documentElement;
  root.classList.remove(Theme.Light, Theme.Dark);
  root.classList.add(finalTheme);
  return finalTheme;
}

/**
 * 应用主题颜色配置
 */
function applyThemeWithColors(
  mode: string,
  themeConfig: CustomThemeConfig | null,
) {
  const finalMode = applyTheme(mode);

  if (themeConfig) {
    const isDark = finalMode === Theme.Dark;
    const colors = isDark ? themeConfig.colors.dark : themeConfig.colors.light;
    applyThemeColors(colors);

    // 保存运行时主题配置
    storage.setRuntimeTheme({
      mode: mode as 'light' | 'dark' | 'system',
      themeName: themeConfig.name,
      themes: themeConfig.colors,
    });
  }

  return finalMode;
}

/**
 * 应用背景图片和透明度到 DOM
 */
function applyBackgroundImage(
  image: string | null,
  opacity: number,
  blur: number,
  maskOpacity: number,
  enabled: boolean,
) {
  const root = document.documentElement;

  if (image && enabled) {
    root.style.setProperty('--custom-bg-image', `url(${image})`);
    root.style.setProperty('--custom-bg-opacity', String(opacity / 100));
    const blurValue = blur > 0 ? `blur(${blur}px)` : 'none';
    root.style.setProperty('--custom-bg-blur', blurValue);
    root.style.setProperty('--custom-mask-opacity', String(maskOpacity / 100));
  } else {
    root.style.removeProperty('--custom-bg-image');
    root.style.removeProperty('--custom-bg-opacity');
    root.style.removeProperty('--custom-bg-blur');
    root.style.removeProperty('--custom-mask-opacity');
  }
}

export const initThemeAtom = atom(null, (_, set) => {
  const theme = storage.getTheme();
  const themeName = storage.getThemeName();
  const customThemes = storage.getCustomThemes();

  // 查找主题配置
  let themeConfig = PRESET_THEMES.find((t) => t.name === themeName) || null;
  if (!themeConfig) {
    themeConfig = customThemes.find((t) => t.name === themeName) || null;
  }
  if (!themeConfig) {
    themeConfig = PRESET_THEMES[0]; // 默认主题
  }

  const className = applyThemeWithColors(theme, themeConfig);
  set(themeAtom, { display: theme, className });
  set(selectedThemeAtom, themeConfig);
  set(customThemesAtom, customThemes);
  setTheme(theme);

  // 初始化背景图片、透明度和模糊度
  const bgImage = storage.getBackgroundImage();
  const bgOpacity = storage.getBackgroundOpacity();
  const bgBlur = storage.getBackgroundBlur();
  const maskOpacity = storage.getMaskOpacity();
  const bgEnabled = storage.getBackgroundEnabled();
  set(backgroundImageAtom, bgImage);
  set(backgroundOpacityAtom, bgOpacity);
  set(backgroundBlurAtom, bgBlur);
  set(maskOpacityAtom, maskOpacity);
  set(backgroundEnabledAtom, bgEnabled);
  applyBackgroundImage(bgImage, bgOpacity, bgBlur, maskOpacity, bgEnabled);
});

export const toggleThemeAtom = atom(null, (get, set) => {
  const display = get(themeAtom).display;
  const selectedTheme = get(selectedThemeAtom);
  const displayList: string[] = [Theme.Light, Theme.Dark, Theme.System];
  let idx = displayList.indexOf(display);
  if (idx < 0) {
    idx = 0;
  }
  idx += 1;
  if (idx >= displayList.length) {
    idx = 0;
  }
  const newDisplay = displayList[idx];
  const newClassName = applyThemeWithColors(newDisplay, selectedTheme);
  set(themeAtom, { display: newDisplay, className: newClassName });
  storage.setTheme(newDisplay);
  setTheme(newDisplay);
});

export const applyMatchMediaAtom = atom(null, (get, set, matches: boolean) => {
  const display = get(themeAtom).display;
  const selectedTheme = get(selectedThemeAtom);
  if (display !== Theme.System) {
    return;
  }
  const theme = matches ? Theme.Dark : Theme.Light;
  const newClassName = applyThemeWithColors(theme, selectedTheme);
  set(themeAtom, { display, className: newClassName });
  setTheme(display);
});

/**
 * 设置主题模式
 */
export const setThemeModeAtom = atom(null, (get, set, mode: string) => {
  const selectedTheme = get(selectedThemeAtom);
  const newClassName = applyThemeWithColors(mode, selectedTheme);
  set(themeAtom, { display: mode, className: newClassName });
  storage.setTheme(mode);
  setTheme(mode);
});

/**
 * 选择主题配色
 */
export const selectThemeAtom = atom(
  null,
  (get, set, themeConfig: CustomThemeConfig) => {
    const mode = get(themeAtom).display;
    const newClassName = applyThemeWithColors(mode, themeConfig);
    set(themeAtom, { display: mode, className: newClassName });
    set(selectedThemeAtom, themeConfig);
    storage.setThemeName(themeConfig.name);
  },
);

/**
 * 添加自定义主题
 */
export const addCustomThemeAtom = atom(
  null,
  (get, set, themeConfig: CustomThemeConfig) => {
    const customThemes = get(customThemesAtom);
    const index = customThemes.findIndex((t) => t.name === themeConfig.name);

    let newCustomThemes: CustomThemeConfig[];
    if (index >= 0) {
      newCustomThemes = [
        ...customThemes.slice(0, index),
        themeConfig,
        ...customThemes.slice(index + 1),
      ];
    } else {
      newCustomThemes = [...customThemes, themeConfig];
    }

    set(customThemesAtom, newCustomThemes);
    storage.setCustomThemes(newCustomThemes);
  },
);

/**
 * 批量添加自定义主题
 */
export const addCustomThemesAtom = atom(
  null,
  (get, set, themeConfigs: CustomThemeConfig[]) => {
    const customThemes = get(customThemesAtom);
    let newCustomThemes = [...customThemes];

    for (const themeConfig of themeConfigs) {
      const index = newCustomThemes.findIndex(
        (t) => t.name === themeConfig.name,
      );
      if (index >= 0) {
        newCustomThemes[index] = themeConfig;
      } else {
        newCustomThemes.push(themeConfig);
      }
    }

    set(customThemesAtom, newCustomThemes);
    storage.setCustomThemes(newCustomThemes);
  },
);

/**
 * 删除自定义主题
 */
export const removeCustomThemeAtom = atom(
  null,
  (get, set, themeName: string) => {
    const customThemes = get(customThemesAtom);
    const newCustomThemes = customThemes.filter((t) => t.name !== themeName);
    set(customThemesAtom, newCustomThemes);
    storage.setCustomThemes(newCustomThemes);
  },
);

/**
 * 设置背景图片
 */
export const setBackgroundImageAtom = atom(
  null,
  (get, set, image: string | null) => {
    const opacity = get(backgroundOpacityAtom);
    const blur = get(backgroundBlurAtom);
    const maskOpacity = get(maskOpacityAtom);
    const enabled = get(backgroundEnabledAtom);
    set(backgroundImageAtom, image);
    storage.setBackgroundImage(image);
    applyBackgroundImage(image, opacity, blur, maskOpacity, enabled);
  },
);

/**
 * 设置是否启用背景
 */
export const setBackgroundEnabledAtom = atom(
  null,
  (get, set, enabled: boolean) => {
    const image = get(backgroundImageAtom);
    const opacity = get(backgroundOpacityAtom);
    const blur = get(backgroundBlurAtom);
    const maskOpacity = get(maskOpacityAtom);
    set(backgroundEnabledAtom, enabled);
    storage.setBackgroundEnabled(enabled);
    applyBackgroundImage(image, opacity, blur, maskOpacity, enabled);
  },
);

/**
 * 设置背景透明度
 */
export const setBackgroundOpacityAtom = atom(
  null,
  (get, set, opacity: number) => {
    const image = get(backgroundImageAtom);
    const blur = get(backgroundBlurAtom);
    const maskOpacity = get(maskOpacityAtom);
    const enabled = get(backgroundEnabledAtom);
    set(backgroundOpacityAtom, opacity);
    storage.setBackgroundOpacity(opacity);
    applyBackgroundImage(image, opacity, blur, maskOpacity, enabled);
  },
);

/**
 * 设置背景模糊度
 */
export const setBackgroundBlurAtom = atom(null, (get, set, blur: number) => {
  const image = get(backgroundImageAtom);
  const opacity = get(backgroundOpacityAtom);
  const maskOpacity = get(maskOpacityAtom);
  const enabled = get(backgroundEnabledAtom);
  set(backgroundBlurAtom, blur);
  storage.setBackgroundBlur(blur);
  applyBackgroundImage(image, opacity, blur, maskOpacity, enabled);
});

/**
 * 设置遮罩透明度
 */
export const setMaskOpacityAtom = atom(
  null,
  (get, set, maskOpacity: number) => {
    const image = get(backgroundImageAtom);
    const opacity = get(backgroundOpacityAtom);
    const blur = get(backgroundBlurAtom);
    const enabled = get(backgroundEnabledAtom);
    set(maskOpacityAtom, maskOpacity);
    storage.setMaskOpacity(maskOpacity);
    applyBackgroundImage(image, opacity, blur, maskOpacity, enabled);
  },
);
