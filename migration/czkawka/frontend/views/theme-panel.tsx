import { openUrl } from '@/nodes/czkawka/upstream/adapters/tauri-opener';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Check,
  ChevronDown,
  Copy,
  Github,
  Moon,
  Palette,
  Sun,
  Trash2,
  TvMinimal,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  customThemesAtom,
  selectedThemeAtom,
  themeAtom,
} from '@/nodes/czkawka/upstream/atom/primitive';
import {
  addCustomThemeAtom,
  addCustomThemesAtom,
  removeCustomThemeAtom,
  selectThemeAtom,
  setThemeModeAtom,
} from '@/nodes/czkawka/upstream/atom/theme';
import {
  Button,
  Input,
  Label,
  ScrollArea,
  Slider,
  Textarea,
  toastError,
} from '@/nodes/czkawka/upstream/components';
import { BoxReveal } from '@/nodes/czkawka/upstream/components/box-reveal';
import { Theme } from '@/nodes/czkawka/upstream/consts';
import { useT } from '@/nodes/czkawka/upstream/hooks';
import type { CustomThemeConfig } from '@/nodes/czkawka/upstream/types';
import {
  fetchThemeFromURL,
  PRESET_THEMES,
  parseTweakcnTheme,
  parseTweakcnThemes,
} from '@/nodes/czkawka/upstream/utils/themeManager';

export function ThemePanel() {
  const t = useT();
  const theme = useAtomValue(themeAtom);
  const selectedTheme = useAtomValue(selectedThemeAtom);
  const customThemes = useAtomValue(customThemesAtom);
  const setThemeMode = useSetAtom(setThemeModeAtom);
  const selectTheme = useSetAtom(selectThemeAtom);
  const addCustomTheme = useSetAtom(addCustomThemeAtom);
  const addCustomThemes = useSetAtom(addCustomThemesAtom);
  const removeCustomTheme = useSetAtom(removeCustomThemeAtom);

  const [themeUrl, setThemeUrl] = useState('');
  const [themeJson, setThemeJson] = useState('');
  const [customThemeName, setCustomThemeName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isCustomThemesExpanded, setIsCustomThemesExpanded] = useState(false);

  const placeholderText =
    'JSON Format (Single or Array):\n[{"name":"My Theme","cssVars":{...}}, ...]';

  const handleImportFromUrl = async () => {
    if (!themeUrl.trim()) return;
    setIsImporting(true);
    try {
      const themeConfig = await fetchThemeFromURL(themeUrl.trim());
      if (themeConfig) {
        addCustomTheme(themeConfig);
        selectTheme(themeConfig);
        setThemeUrl('');
      } else {
        toastError(t('Import theme failed'), 'Invalid theme URL');
      }
    } catch (error) {
      toastError(t('Import theme failed'), error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromJson = () => {
    const raw = themeJson.trim();
    if (!raw) return;
    try {
      const themeConfigs = parseTweakcnThemes(raw);
      if (themeConfigs.length > 0) {
        addCustomThemes(themeConfigs);
        if (themeConfigs.length === 1) {
          selectTheme(themeConfigs[0]);
        }
        setThemeJson('');
      } else {
        toastError(t('Import theme failed'), 'Invalid JSON format');
      }
    } catch (error) {
      toastError(t('Import theme failed'), error);
    }
  };

  const handleSaveCustomTheme = () => {
    if (!selectedTheme) return;
    const name = (
      customThemeName ||
      selectedTheme.name ||
      'Custom Theme'
    ).trim();
    const themeConfig: CustomThemeConfig = {
      name,
      description: 'Custom theme',
      colors: {
        light: { ...selectedTheme.colors.light },
        dark: { ...selectedTheme.colors.dark },
      },
    };
    addCustomTheme(themeConfig);
    selectTheme(themeConfig);
    setCustomThemeName('');
  };

  const handleDeleteCustomTheme = (themeName: string) => {
    removeCustomTheme(themeName);
    // 如果删除的是当前选中的主题，切换到默认主题
    if (selectedTheme?.name === themeName) {
      selectTheme(PRESET_THEMES[0]);
    }
  };

  const exportTheme = (theme: CustomThemeConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    const exportData = {
      name: theme.name,
      description: theme.description,
      cssVars: { light: theme.colors.light, dark: theme.colors.dark },
    };
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
  };

  const exportAllThemes = () => {
    const exportData = customThemes.map((theme) => ({
      name: theme.name,
      description: theme.description,
      cssVars: { light: theme.colors.light, dark: theme.colors.dark },
    }));
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
  };

  const importAllThemes = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const themeConfigs = parseTweakcnThemes(text);
      if (themeConfigs.length > 0) {
        addCustomThemes(themeConfigs);
      }
    } catch (e) {
      toastError(t('Import theme failed'), e);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4 pt-2 pb-4">
        {/* 主题模式选择 */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold">{t('Theme mode')}</Label>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setThemeMode(Theme.Light)}
              className={`hover:bg-accent flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${
                theme.display === Theme.Light
                  ? 'border-primary bg-primary/5'
                  : ''
              }`}
            >
              <Sun className="h-6 w-6" />
              <span className="text-sm font-medium">{t('Light')}</span>
              {theme.display === Theme.Light && (
                <Check className="text-primary h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setThemeMode(Theme.Dark)}
              className={`hover:bg-accent flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${
                theme.display === Theme.Dark
                  ? 'border-primary bg-primary/5'
                  : ''
              }`}
            >
              <Moon className="h-6 w-6" />
              <span className="text-sm font-medium">{t('Dark')}</span>
              {theme.display === Theme.Dark && (
                <Check className="text-primary h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setThemeMode(Theme.System)}
              className={`hover:bg-accent flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${
                theme.display === Theme.System
                  ? 'border-primary bg-primary/5'
                  : ''
              }`}
            >
              <TvMinimal className="h-6 w-6" />
              <span className="text-sm font-medium">{t('System')}</span>
              {theme.display === Theme.System && (
                <Check className="text-primary h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* 预设主题 */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold">{t('Color scheme')}</Label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {PRESET_THEMES.map((presetTheme) => (
              <button
                type="button"
                key={presetTheme.name}
                onClick={() => selectTheme(presetTheme)}
                className={`hover:bg-accent flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                  selectedTheme?.name === presetTheme.name
                    ? 'border-primary bg-primary/5'
                    : ''
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <h4 className="font-medium">{presetTheme.name}</h4>
                  {selectedTheme?.name === presetTheme.name && (
                    <Check className="text-primary h-4 w-4" />
                  )}
                </div>
                <p className="text-muted-foreground text-sm">
                  {presetTheme.description}
                </p>
                {/* 颜色预览 */}
                <div className="mt-2 flex gap-2">
                  <div
                    className="h-6 w-6 rounded-full border"
                    style={{
                      background: presetTheme.colors.light.primary,
                    }}
                    title="Light primary"
                  />
                  <div
                    className="h-6 w-6 rounded-full border"
                    style={{
                      background: presetTheme.colors.dark.primary,
                    }}
                    title="Dark primary"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 自定义主题 */}
        {customThemes.length > 0 && (
          <div className="space-y-3">
            <div
              className="flex w-full items-center justify-between cursor-pointer hover:bg-muted/30 p-1 -m-1 rounded-md transition-colors"
              onClick={() => setIsCustomThemesExpanded(!isCustomThemesExpanded)}
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${isCustomThemesExpanded ? '' : '-rotate-90'}`}
                />
                <Label className="text-sm font-semibold cursor-pointer">
                  {t('Custom themes')} ({customThemes.length})
                </Label>
              </div>
              {isCustomThemesExpanded && (
                <div
                  className="flex gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={importAllThemes}
                  >
                    {t('Import all')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={exportAllThemes}
                  >
                    {t('Export all')}
                  </Button>
                </div>
              )}
            </div>

            {isCustomThemesExpanded && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 animate-in fade-in slide-in-from-top-1 duration-200">
                {customThemes.map((customTheme) => (
                  <div
                    key={customTheme.name}
                    className={`hover:bg-accent group relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                      selectedTheme?.name === customTheme.name
                        ? 'border-primary bg-primary/5'
                        : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => selectTheme(customTheme)}
                    >
                      <div className="flex w-full items-center justify-between">
                        <h4 className="font-medium">{customTheme.name}</h4>
                        {selectedTheme?.name === customTheme.name && (
                          <Check className="text-primary h-4 w-4" />
                        )}
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {customTheme.description}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <div
                          className="h-6 w-6 rounded-full border"
                          style={{
                            background:
                              customTheme.colors.light.primary ||
                              'hsl(0 0% 50%)',
                          }}
                          title="Light primary"
                        />
                        <div
                          className="h-6 w-6 rounded-full border"
                          style={{
                            background:
                              customTheme.colors.dark.primary ||
                              'hsl(0 0% 50%)',
                          }}
                          title="Dark primary"
                        />
                      </div>
                    </button>
                    <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => exportTheme(customTheme, e)}
                        title={t('Export theme')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() =>
                          handleDeleteCustomTheme(customTheme.name)
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 保存当前主题 */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold">
            {t('Save current theme')}
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder={t('Custom theme name')}
              value={customThemeName}
              onChange={(e) => setCustomThemeName(e.target.value)}
            />
            <Button size="sm" onClick={handleSaveCustomTheme}>
              {t('Save')}
            </Button>
          </div>
        </div>

        {/* 从 URL 导入主题 */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold">
            {t('Import from URL')}
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://tweakcn.com/r/themes/perpetuity.json"
              value={themeUrl}
              onChange={(e) => setThemeUrl(e.target.value)}
            />
            <Button
              size="sm"
              onClick={handleImportFromUrl}
              disabled={isImporting}
            >
              {isImporting ? '...' : t('Import')}
            </Button>
          </div>
        </div>

        {/* 从 JSON 导入主题 */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold">
            {t('Import from JSON')}
          </Label>
          <div className="flex flex-col gap-2">
            <Textarea
              className="min-h-[120px] resize-y font-mono text-xs"
              value={themeJson}
              onChange={(e) => setThemeJson(e.target.value)}
              placeholder={placeholderText}
              rows={5}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleImportFromJson}>
                {t('Import JSON')}
              </Button>
            </div>
          </div>
        </div>

        {/* 颜色预览 */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold">{t('Color preview')}</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-primary text-primary-foreground rounded-lg border p-3">
              <p className="text-sm font-medium">Primary</p>
            </div>
            <div className="bg-secondary text-secondary-foreground rounded-lg border p-3">
              <p className="text-sm font-medium">Secondary</p>
            </div>
            <div className="bg-accent text-accent-foreground rounded-lg border p-3">
              <p className="text-sm font-medium">Accent</p>
            </div>
            <div className="bg-muted text-muted-foreground rounded-lg border p-3">
              <p className="text-sm font-medium">Muted</p>
            </div>
          </div>
        </div>

        {/* 提示信息 */}
        <div className="border-primary/20 bg-primary/5 rounded-lg border p-4">
          <p className="text-sm">
            <strong>💡 {t('Tip')}:</strong> {t('Theme settings are auto-saved')}
          </p>
        </div>
      </div>
    </ScrollArea>
  );
}
