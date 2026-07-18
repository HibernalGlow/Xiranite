import { open } from '@/nodes/czkawka/upstream/adapters/tauri-dialog';
import { openPath, openUrl } from '@/nodes/czkawka/upstream/adapters/tauri-opener';
import { motion } from 'motion/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  CircleHelp,
  Database,
  FileJson,
  Fingerprint,
  Folder,
  FolderSearch,
  Github,
  History,
  Image as ImageIcon,
  LayoutGrid,
  Link2Off,
  Palette,
  Settings,
  Trash2,
} from 'lucide-react';
import { useEffect } from 'react';
import { initCurrentPresetAtom } from '@/nodes/czkawka/upstream/atom/preset';
import { platformSettingsAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import {
  Button,
  InputNumber,
  Label,
  ScrollArea,
  Slider,
  Switch,
  Textarea,
  TooltipButton,
  toastError,
} from '@/nodes/czkawka/upstream/components';
import { BoxReveal } from '@/nodes/czkawka/upstream/components/box-reveal';
import { Form, FormItem } from '@/nodes/czkawka/upstream/components/form';
import { ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ToggleBadge } from '@/nodes/czkawka/upstream/components/toggle-badge';
import { MAXIMUM_FILE_SIZE } from '@/nodes/czkawka/upstream/consts';
import { useBoolean, useT } from '@/nodes/czkawka/upstream/hooks';
import { eventPreventDefault } from '@/nodes/czkawka/upstream/utils/event';
import { CardPanelManager } from './card-panel-manager';
import { PresetSelect } from './preset-select';
import { ThemePanel } from './theme-panel';

export function SettingsButton(props: ButtonProps) {
  const dialogOpen = useBoolean();
  const isPreventDialogClose = useBoolean();
  const initCurrentPreset = useSetAtom(initCurrentPresetAtom);
  const t = useT();

  useEffect(() => {
    initCurrentPreset();
  }, []);

  return (
    <Dialog
      open={dialogOpen.value}
      onOpenChange={(open) => {
        if (isPreventDialogClose.value) {
          return;
        }
        dialogOpen.set(open);
      }}
      checkOpenedSelect={false}
    >
      <DialogTrigger asChild>
        <TooltipButton tooltip={t('Settings')} {...props}>
          <Settings className="h-4 w-4" />
        </TooltipButton>
      </DialogTrigger>
      <DialogContent className="max-w-[700px] outline-none">
        {/* 顶部应用标识与源码链接 */}
        <div
          className="flex items-center justify-between border-b border-border/40 pb-5 mb-5 select-none"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-5">
            <div className="relative group perspective-1000">
              <div className="absolute -inset-2 bg-gradient-to-tr from-primary/30 via-purple-500/20 to-pink-500/30 rounded-full blur-xl opacity-0 group-hover:opacity-60 transition-all duration-700 animate-pulse"></div>
              <motion.img
                whileHover={{ rotate: 5, scale: 1.05 }}
                className="relative size-14 drop-shadow-2xl transition-all duration-500 cursor-help"
                src="/icon.ico"
                alt="czkawka icon"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <BoxReveal
                  boxColor="hsl(var(--primary))"
                  duration={0.6}
                  delay={0.1}
                >
                  <span className="font-serif text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground to-foreground/50">
                    {PKG_NAME || 'Czkawka'}
                  </span>
                </BoxReveal>
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.9, type: 'spring', stiffness: 200 }}
                  className="text-[10px] font-mono font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded shadow-sm uppercase tracking-widest"
                >
                  v{PKG_VERSION}
                </motion.span>
              </div>
              <BoxReveal
                boxColor="hsl(var(--muted-foreground))"
                duration={0.6}
                delay={0.3}
              >
                <p className="text-muted-foreground text-xs font-bold tracking-[0.2em] uppercase opacity-60">
                  {t('Settings')}
                </p>
              </BoxReveal>
            </div>
          </div>

          <BoxReveal boxColor="#f472b6" duration={0.6} delay={0.6}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openUrl(REPOSITORY_URL)}
              className="h-10 flex items-center gap-3 rounded-full border-primary/20 hover:border-primary/60 hover:bg-primary/5 transition-all group px-5 shadow-lg active:scale-95"
            >
              <Github className="h-4 w-4 group-hover:rotate-[360deg] transition-transform duration-1000 ease-in-out" />
              <span className="text-xs font-black tracking-widest uppercase">
                Source Code
              </span>
            </Button>
          </BoxReveal>
        </div>
        <Tabs defaultValue="general" className="h-[550px] flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              {t('General settings')}
            </TabsTrigger>
            <TabsTrigger value="theme" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              {t('Theme settings')}
            </TabsTrigger>
            <TabsTrigger value="cards" className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              {t('Card panels')}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="general"
            className="flex-1 flex flex-col overflow-hidden"
          >
            <PresetSelect
              onPreventDialogCloseChange={isPreventDialogClose.set}
            />
            <SettingsContent />
          </TabsContent>
          <TabsContent
            value="theme"
            className="flex-1 h-[480px] overflow-hidden"
          >
            <ThemePanel />
          </TabsContent>
          <TabsContent
            value="cards"
            className="flex-1 h-[480px] overflow-hidden"
          >
            <CardPanelManager />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SettingsContent() {
  const [settings, setSettings] = useAtom(settingsAtom);
  const platformSettings = useAtomValue(platformSettingsAtom);
  const t = useT();

  const handleSettingsChange = (v: Record<string, any>) => {
    setSettings((prev) => ({ ...prev, ...v }));
  };

  const handleOpenCacheFolder = () => {
    if (!platformSettings.cacheDirPath) {
      return;
    }
    openPath(platformSettings.cacheDirPath).catch((err) => {
      toastError(t('Failed to open cache folder'), err);
    });
  };

  const handleBrowseFolder = async (settingKey: string) => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected) {
        handleSettingsChange({ [settingKey]: selected });
      }
    } catch (error) {
      toastError(t('Failed to select folder'), error);
    }
  };

  return (
    <ScrollArea className="flex-1">
      <Form className="pr-3" value={settings} onChange={handleSettingsChange}>
        <GroupTitle>{t('General settings')}</GroupTitle>
        <FormItem
          name="excludedItems"
          label={t('Excluded items')}
          comp="textarea"
        >
          <Textarea rows={2} />
        </FormItem>
        <FormItem
          name="allowedExtensions"
          label={t('Allowed extensions')}
          comp="textarea"
        >
          <Textarea rows={2} />
        </FormItem>
        <FormItem
          name="excludedExtensions"
          label={t('Excluded extensions')}
          comp="textarea"
        >
          <Textarea rows={2} />
        </FormItem>
        <div className="flex items-center gap-2">
          <Label className="flex-shrink-0">{t('File size')}(KB):</Label>
          <FormItem name="minimumFileSize" comp="input-number">
            <InputNumber minValue={0} maxValue={MAXIMUM_FILE_SIZE} />
          </FormItem>
          ~
          <FormItem name="maximumFileSize" comp="input-number">
            <InputNumber minValue={0} maxValue={MAXIMUM_FILE_SIZE} />
          </FormItem>
        </div>
        <div className="flex flex-wrap gap-2 py-2">
          <FormItem
            name="recursiveSearch"
            label={t('Recursive search')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <FolderSearch className="h-3.5 w-3.5" />
              {t('Recursive search')}
            </ToggleBadge>
          </FormItem>
          <FormItem name="useCache" label={t('Use cache')} comp="badge-switch">
            <ToggleBadge className="gap-1.5">
              <Database className="h-3.5 w-3.5" />
              {t('Use cache')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="saveAlsoAsJson"
            label={t('Also save cache as JSON file')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <FileJson className="h-3.5 w-3.5" />
              {t('Also save cache as JSON file')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="moveDeletedFilesToTrash"
            label={t('Move deleted files to trash')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              {t('Move deleted files to trash')}
            </ToggleBadge>
          </FormItem>
        </div>
        <FormItem
          name="referencePathKeywords"
          label={t('Reference path keywords')}
          description={t('Reference path keywords hint')}
          comp="textarea"
        >
          <Textarea rows={1} placeholder="#compare" />
        </FormItem>

        <div className="flex flex-col gap-2 py-2">
          <Label>{t('Cache folder path')}</Label>
          <div className="flex gap-2">
            <Input
              value={settings.customCacheFolderPath}
              onChange={(e) =>
                handleSettingsChange({ customCacheFolderPath: e.target.value })
              }
              placeholder={platformSettings.cacheDirPath || t('System default')}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={() => handleBrowseFolder('customCacheFolderPath')}
              className="flex-shrink-0"
            >
              <Folder className="h-4 w-4 mr-1" />
              {t('Browse')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 py-2">
          <Label>{t('Config folder path')}</Label>
          <div className="flex gap-2">
            <Input
              value={settings.customConfigFolderPath}
              onChange={(e) =>
                handleSettingsChange({ customConfigFolderPath: e.target.value })
              }
              placeholder={t('System default')}
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={() => handleBrowseFolder('customConfigFolderPath')}
              className="flex-shrink-0"
            >
              <Folder className="h-4 w-4 mr-1" />
              {t('Browse')}
            </Button>
          </div>
        </div>

        <FormItem
          name="threadNumber"
          label={
            <span className="inline-flex items-center">
              {t('Thread number')}
              <TooltipButton
                tooltip={t('Thread number tip')}
                onClick={eventPreventDefault}
              >
                <CircleHelp />
              </TooltipButton>
            </span>
          }
          comp="slider"
          suffix={
            <span>
              {settings.threadNumber}/{platformSettings.availableThreadNumber}
            </span>
          }
        >
          <Slider min={1} max={platformSettings.availableThreadNumber} />
        </FormItem>
        <GroupTitle>{t('Duplicate Files')}</GroupTitle>
        <FormItem
          name="duplicateMinimalHashCacheSize"
          label={`${t('Minimal size of cached files')} - ${t('Hash')} (KB)`}
          comp="input-number"
        >
          <InputNumber minValue={1} />
        </FormItem>
        <FormItem
          name="duplicateMinimalPrehashCacheSize"
          label={`${t('Minimal size of cached files')} - ${t('Prehash')} (KB)`}
          comp="input-number"
        >
          <InputNumber minValue={1} />
        </FormItem>
        <div className="flex flex-wrap gap-2 py-2">
          <FormItem
            name="duplicateImagePreview"
            label={t('Image preview')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              {t('Image preview')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="duplicateHideHardLinks"
            label={t('Hide hard links')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <Link2Off className="h-3.5 w-3.5" />
              {t('Hide hard links')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="duplicateUsePrehash"
            label={t('Use prehash')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <Fingerprint className="h-3.5 w-3.5" />
              {t('Use prehash')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="duplicateDeleteOutdatedEntries"
            label={t('Delete automatically outdated entries')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              {t('Delete automatically outdated entries')}
            </ToggleBadge>
          </FormItem>
        </div>
        <GroupTitle>{t('Similar Images')}</GroupTitle>
        <div className="flex flex-wrap gap-2 py-2">
          <FormItem
            name="similarImagesShowImagePreview"
            label={t('Image preview')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              {t('Image preview')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="similarImagesHideHardLinks"
            label={t('Hide hard links')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <Link2Off className="h-3.5 w-3.5" />
              {t('Hide hard links')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="similarImagesDeleteOutdatedEntries"
            label={t('Delete automatically outdated entries')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              {t('Delete automatically outdated entries')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="similarVideosHideHardLinks"
            label={t('Hide hard links')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <Link2Off className="h-3.5 w-3.5" />
              {t('Hide hard links')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="similarVideosDeleteOutdatedEntries"
            label={t('Delete automatically outdated entries')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              {t('Delete automatically outdated entries')}
            </ToggleBadge>
          </FormItem>
          <FormItem
            name="similarMusicDeleteOutdatedEntries"
            label={t('Delete automatically outdated entries')}
            comp="badge-switch"
          >
            <ToggleBadge className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              {t('Delete automatically outdated entries')}
            </ToggleBadge>
          </FormItem>
        </div>
      </Form>
      <GroupTitle>{t('Other')}</GroupTitle>
      <Button variant="secondary" onClick={handleOpenCacheFolder}>
        {t('Open cache folder')}
      </Button>
    </ScrollArea>
  );
}

function GroupTitle(props: { children?: React.ReactNode }) {
  const { children } = props;

  return <h3 className="w-full text-center">{children}</h3>;
}
