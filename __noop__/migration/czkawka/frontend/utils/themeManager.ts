/**
 * 主题管理工具
 * 用于从 tweakcn.com 导入和应用主题
 */

export interface TweakcnTheme {
  name: string;
  cssVars: {
    light: Record<string, string>;
    dark: Record<string, string>;
    theme?: Record<string, string>;
  };
}

export interface ThemeColors {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface CustomThemeConfig {
  name: string;
  description: string;
  colors: ThemeColors;
}

/**
 * 从 tweakcn JSON 解析主题配置
 */
/**
 * 从 tweakcn JSON 解析主题配置 (支持单个或数组)
 */
export function parseTweakcnThemes(json: string): CustomThemeConfig[] {
  try {
    const parsed = JSON.parse(json);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const results: CustomThemeConfig[] = [];

    for (const item of items) {
      if (
        !item ||
        !item.cssVars ||
        (!item.cssVars.light && !item.cssVars.dark)
      ) {
        continue;
      }

      const base = item.cssVars.theme ?? {};
      const light = { ...base, ...(item.cssVars.light ?? {}) };
      const dark = {
        ...base,
        ...(item.cssVars.dark ?? item.cssVars.light ?? {}),
      };

      results.push({
        name: item.name || 'Custom Theme',
        description: item.description || '来自 JSON 的主题',
        colors: { light, dark },
      });
    }

    return results;
  } catch (error) {
    console.error('从 JSON 导入主题失败', error);
    return [];
  }
}

/**
 * 从 tweakcn JSON 解析单个主题配置 (兼容旧方法)
 */
export function parseTweakcnTheme(json: string): CustomThemeConfig | null {
  const themes = parseTweakcnThemes(json);
  return themes.length > 0 ? themes[0] : null;
}

/**
 * 从 URL 获取主题
 */
export async function fetchThemeFromURL(
  url: string,
): Promise<CustomThemeConfig | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const theme = (await response.json()) as TweakcnTheme;

    const base = theme.cssVars.theme ?? {};
    const light = { ...base, ...theme.cssVars.light };
    const dark = { ...base, ...theme.cssVars.dark };

    return {
      name: theme.name || 'Custom Theme',
      description: '来自 tweakcn 的主题',
      colors: { light, dark },
    };
  } catch (error) {
    console.error('获取主题失败:', error);
    return null;
  }
}

/**
 * 应用主题颜色到 document.documentElement
 */
export function applyThemeColors(colors: Record<string, string>) {
  const root = document.documentElement;
  const sidebarVars: Record<string, string> = {
    'sidebar-background': 'background',
    'sidebar-foreground': 'foreground',
    'sidebar-primary': 'primary',
    'sidebar-primary-foreground': 'primary-foreground',
    'sidebar-accent': 'accent',
    'sidebar-accent-foreground': 'accent-foreground',
    'sidebar-border': 'border',
    'sidebar-ring': 'ring',
  };

  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string') {
      root.style.setProperty(`--${key}`, value);

      // 特殊处理: sidebar 属性映射到 sidebar-background
      if (key === 'sidebar') {
        root.style.setProperty('--sidebar-background', value);
      }

      // 如果是基础变量，同时设置对应的 sidebar 变量（除非 sidebar 变量已显式定义）
      // 注意：sidebar 变量需要提取 HSL 值（去除 hsl() 包裹） - 已不再需强制去除，因 tailwind 配置已更新支持直接变量
      // const hslMatch = value.match(/hsl\((.*)\)/);
      // const hslValue = hslMatch ? hslMatch[1] : value;
      // 直接使用 value，支持 oklch 等

      for (const [sKey, bKey] of Object.entries(sidebarVars)) {
        // 如果当前 key 是 fallback 源 (如 background)
        if (key === bKey) {
          // 检查是否已有明确的 sidebar 定义
          const hasExplicit =
            colors[sKey] ||
            (sKey === 'sidebar-background' && colors['sidebar']);
          if (!hasExplicit) {
            root.style.setProperty(`--${sKey}`, value);
          }
        }
      }
    }
  }
}

/**
 * 清除自定义主题颜色
 */
export function clearThemeColors(keys: string[]) {
  const root = document.documentElement;
  for (const key of keys) {
    root.style.removeProperty(`--${key}`);
  }
}

/**
 * 预设主题列表
 */
export const PRESET_THEMES: CustomThemeConfig[] = [
  {
    name: 'Default',
    description: '默认主题',
    colors: {
      light: {
        background: 'hsl(0 0% 100%)',
        foreground: 'hsl(222.2 84% 4.9%)',
        card: 'hsl(0 0% 100%)',
        'card-foreground': 'hsl(222.2 84% 4.9%)',
        popover: 'hsl(0 0% 100%)',
        'popover-foreground': 'hsl(222.2 84% 4.9%)',
        primary: 'hsl(221.2 83.2% 53.3%)',
        'primary-foreground': 'hsl(210 40% 98%)',
        secondary: 'hsl(210 40% 96.1%)',
        'secondary-foreground': 'hsl(222.2 47.4% 11.2%)',
        muted: 'hsl(210 40% 96.1%)',
        'muted-foreground': 'hsl(215.4 16.3% 46.9%)',
        accent: 'hsl(210 40% 96.1%)',
        'accent-foreground': 'hsl(222.2 47.4% 11.2%)',
        destructive: 'hsl(0 84.2% 60.2%)',
        'destructive-foreground': 'hsl(210 40% 98%)',
        border: 'hsl(214.3 31.8% 91.4%)',
        input: 'hsl(214.3 31.8% 91.4%)',
        ring: 'hsl(221.2 83.2% 53.3%)',
      },
      dark: {
        background: 'hsl(210 34.38% 12.55%)',
        foreground: 'hsl(210 40% 98%)',
        card: 'hsl(222.2 84% 4.9%)',
        'card-foreground': 'hsl(210 40% 98%)',
        popover: 'hsl(222.2 84% 4.9%)',
        'popover-foreground': 'hsl(210 40% 98%)',
        primary: 'hsl(217.2 91.2% 59.8%)',
        'primary-foreground': 'hsl(222.2 47.4% 11.2%)',
        secondary: 'hsl(217.2 32.6% 17.5%)',
        'secondary-foreground': 'hsl(210 40% 98%)',
        muted: 'hsl(217.2 32.6% 17.5%)',
        'muted-foreground': 'hsl(215 20.2% 65.1%)',
        accent: 'hsl(217.2 32.6% 17.5%)',
        'accent-foreground': 'hsl(210 40% 98%)',
        destructive: 'hsl(0 62.8% 30.6%)',
        'destructive-foreground': 'hsl(210 40% 98%)',
        border: 'hsl(217.2 32.6% 17.5%)',
        input: 'hsl(217.2 32.6% 17.5%)',
        ring: 'hsl(224.3 76.3% 48%)',
      },
    },
  },
  {
    name: 'Amethyst Haze',
    description: '优雅的紫色调主题',
    colors: {
      light: {
        background: 'hsl(300 30% 98%)',
        foreground: 'hsl(287 30% 20%)',
        card: 'hsl(300 25% 97%)',
        'card-foreground': 'hsl(287 30% 20%)',
        popover: 'hsl(300 25% 97%)',
        'popover-foreground': 'hsl(287 30% 20%)',
        primary: 'hsl(293 60% 45%)',
        'primary-foreground': 'hsl(0 0% 100%)',
        secondary: 'hsl(300 20% 92%)',
        'secondary-foreground': 'hsl(287 30% 20%)',
        muted: 'hsl(300 20% 92%)',
        'muted-foreground': 'hsl(287 15% 45%)',
        accent: 'hsl(300 20% 92%)',
        'accent-foreground': 'hsl(287 30% 20%)',
        destructive: 'hsl(0 84% 60%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(300 20% 88%)',
        input: 'hsl(300 20% 88%)',
        ring: 'hsl(293 60% 45%)',
      },
      dark: {
        background: 'hsl(293 25% 14%)',
        foreground: 'hsl(293 15% 90%)',
        card: 'hsl(293 25% 12%)',
        'card-foreground': 'hsl(293 15% 90%)',
        popover: 'hsl(293 25% 12%)',
        'popover-foreground': 'hsl(293 15% 90%)',
        primary: 'hsl(293 55% 60%)',
        'primary-foreground': 'hsl(293 25% 14%)',
        secondary: 'hsl(293 20% 22%)',
        'secondary-foreground': 'hsl(293 15% 90%)',
        muted: 'hsl(293 20% 22%)',
        'muted-foreground': 'hsl(293 15% 65%)',
        accent: 'hsl(293 20% 22%)',
        'accent-foreground': 'hsl(293 15% 90%)',
        destructive: 'hsl(0 63% 31%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(293 20% 22%)',
        input: 'hsl(293 20% 22%)',
        ring: 'hsl(293 55% 60%)',
      },
    },
  },
  {
    name: 'Ocean Breeze',
    description: '清新的海洋蓝主题',
    colors: {
      light: {
        background: 'hsl(200 30% 98%)',
        foreground: 'hsl(200 30% 15%)',
        card: 'hsl(200 25% 97%)',
        'card-foreground': 'hsl(200 30% 15%)',
        popover: 'hsl(200 25% 97%)',
        'popover-foreground': 'hsl(200 30% 15%)',
        primary: 'hsl(200 80% 45%)',
        'primary-foreground': 'hsl(0 0% 100%)',
        secondary: 'hsl(200 20% 92%)',
        'secondary-foreground': 'hsl(200 30% 15%)',
        muted: 'hsl(200 20% 92%)',
        'muted-foreground': 'hsl(200 15% 45%)',
        accent: 'hsl(200 20% 92%)',
        'accent-foreground': 'hsl(200 30% 15%)',
        destructive: 'hsl(0 84% 60%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(200 20% 88%)',
        input: 'hsl(200 20% 88%)',
        ring: 'hsl(200 80% 45%)',
      },
      dark: {
        background: 'hsl(200 25% 12%)',
        foreground: 'hsl(200 15% 92%)',
        card: 'hsl(200 25% 10%)',
        'card-foreground': 'hsl(200 15% 92%)',
        popover: 'hsl(200 25% 10%)',
        'popover-foreground': 'hsl(200 15% 92%)',
        primary: 'hsl(200 70% 55%)',
        'primary-foreground': 'hsl(200 25% 12%)',
        secondary: 'hsl(200 20% 20%)',
        'secondary-foreground': 'hsl(200 15% 92%)',
        muted: 'hsl(200 20% 20%)',
        'muted-foreground': 'hsl(200 15% 65%)',
        accent: 'hsl(200 20% 20%)',
        'accent-foreground': 'hsl(200 15% 92%)',
        destructive: 'hsl(0 63% 31%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(200 20% 20%)',
        input: 'hsl(200 20% 20%)',
        ring: 'hsl(200 70% 55%)',
      },
    },
  },
  {
    name: 'Forest Mist',
    description: '自然的森林绿主题',
    colors: {
      light: {
        background: 'hsl(140 25% 98%)',
        foreground: 'hsl(140 30% 15%)',
        card: 'hsl(140 20% 97%)',
        'card-foreground': 'hsl(140 30% 15%)',
        popover: 'hsl(140 20% 97%)',
        'popover-foreground': 'hsl(140 30% 15%)',
        primary: 'hsl(140 60% 40%)',
        'primary-foreground': 'hsl(0 0% 100%)',
        secondary: 'hsl(140 15% 92%)',
        'secondary-foreground': 'hsl(140 30% 15%)',
        muted: 'hsl(140 15% 92%)',
        'muted-foreground': 'hsl(140 15% 45%)',
        accent: 'hsl(140 15% 92%)',
        'accent-foreground': 'hsl(140 30% 15%)',
        destructive: 'hsl(0 84% 60%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(140 15% 88%)',
        input: 'hsl(140 15% 88%)',
        ring: 'hsl(140 60% 40%)',
      },
      dark: {
        background: 'hsl(140 25% 10%)',
        foreground: 'hsl(140 15% 92%)',
        card: 'hsl(140 25% 8%)',
        'card-foreground': 'hsl(140 15% 92%)',
        popover: 'hsl(140 25% 8%)',
        'popover-foreground': 'hsl(140 15% 92%)',
        primary: 'hsl(140 50% 50%)',
        'primary-foreground': 'hsl(140 25% 10%)',
        secondary: 'hsl(140 20% 18%)',
        'secondary-foreground': 'hsl(140 15% 92%)',
        muted: 'hsl(140 20% 18%)',
        'muted-foreground': 'hsl(140 15% 65%)',
        accent: 'hsl(140 20% 18%)',
        'accent-foreground': 'hsl(140 15% 92%)',
        destructive: 'hsl(0 63% 31%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(140 20% 18%)',
        input: 'hsl(140 20% 18%)',
        ring: 'hsl(140 50% 50%)',
      },
    },
  },
  {
    name: 'Sunset Glow',
    description: '温暖的日落橙主题',
    colors: {
      light: {
        background: 'hsl(30 30% 98%)',
        foreground: 'hsl(30 30% 15%)',
        card: 'hsl(30 25% 97%)',
        'card-foreground': 'hsl(30 30% 15%)',
        popover: 'hsl(30 25% 97%)',
        'popover-foreground': 'hsl(30 30% 15%)',
        primary: 'hsl(25 90% 55%)',
        'primary-foreground': 'hsl(0 0% 100%)',
        secondary: 'hsl(30 20% 92%)',
        'secondary-foreground': 'hsl(30 30% 15%)',
        muted: 'hsl(30 20% 92%)',
        'muted-foreground': 'hsl(30 15% 45%)',
        accent: 'hsl(30 20% 92%)',
        'accent-foreground': 'hsl(30 30% 15%)',
        destructive: 'hsl(0 84% 60%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(30 20% 88%)',
        input: 'hsl(30 20% 88%)',
        ring: 'hsl(25 90% 55%)',
      },
      dark: {
        background: 'hsl(25 25% 10%)',
        foreground: 'hsl(30 15% 92%)',
        card: 'hsl(25 25% 8%)',
        'card-foreground': 'hsl(30 15% 92%)',
        popover: 'hsl(25 25% 8%)',
        'popover-foreground': 'hsl(30 15% 92%)',
        primary: 'hsl(25 80% 55%)',
        'primary-foreground': 'hsl(25 25% 10%)',
        secondary: 'hsl(25 20% 18%)',
        'secondary-foreground': 'hsl(30 15% 92%)',
        muted: 'hsl(25 20% 18%)',
        'muted-foreground': 'hsl(30 15% 65%)',
        accent: 'hsl(25 20% 18%)',
        'accent-foreground': 'hsl(30 15% 92%)',
        destructive: 'hsl(0 63% 31%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
        border: 'hsl(25 20% 18%)',
        input: 'hsl(25 20% 18%)',
        ring: 'hsl(25 80% 55%)',
      },
    },
  },
];
