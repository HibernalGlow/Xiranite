import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  ArrowLeftRight,
  CaseSensitive,
  Eye,
  FileArchive,
  FileAudio,
  FileImage,
  FileType,
  Fingerprint,
  Image as ImageIcon,
  Minimize2,
  Music,
  Ruler,
  Save,
  SearchCode,
  Settings2,
  Trash2,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { currentToolAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import {
  type SimilarImagesPresetConfig,
  similarImagesPresetsAtom,
} from '@/nodes/czkawka/upstream/atom/similar-images-presets';
import {
  Badge,
  Button,
  CheckboxWithLabel,
  Input,
  InputNumber,
  Label,
  OperationButton,
  Select,
  Slider,
  ToggleBadge,
  TooltipButton,
} from '@/nodes/czkawka/upstream/components';
import { Form, FormItem } from '@/nodes/czkawka/upstream/components/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  BigFilesSearchMode,
  DuplicatesAvailableHashType,
  DuplicatesCheckMethod,
  SimilarImagesHashAlgorithm,
  SimilarImagesResizeAlgorithm,
  SimilarMusicAudioCheckType,
  Tools,
} from '@/nodes/czkawka/upstream/consts';
import { useBoolean, useT } from '@/nodes/czkawka/upstream/hooks';
import { ipc } from '@/nodes/czkawka/upstream/ipc';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';

// 通用路径显示设置组件
function PathDisplaySettings({
  useLabelStyle = false,
}: {
  useLabelStyle?: boolean;
}) {
  const t = useT();

  if (useLabelStyle) {
    return (
      <FormItem name="reversePathDisplay" comp="checkbox">
        <CheckboxWithLabel label={t('Reverse path display')} />
      </FormItem>
    );
  }

  return (
    <FormItem name="reversePathDisplay" comp="badge-switch">
      <TooltipButton tooltip={t('Reverse path display')}>
        <ToggleBadge>
          <ArrowLeftRight className="h-4 w-4" />
        </ToggleBadge>
      </TooltipButton>
    </FormItem>
  );
}

// 通用图片设置组件
function ImageDisplaySettings({
  useLabelStyle = false,
}: {
  useLabelStyle?: boolean;
}) {
  const settings = useAtomValue(settingsAtom);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheStats, setCacheStats] = useState<{
    count: number;
    size: string;
  } | null>(null);
  const t = useT();

  const loadCacheStats = useCallback(async () => {
    try {
      const [count, sizeBytes] = await ipc.getThumbnailCacheStats();
      const sizeStr =
        sizeBytes > 1024 * 1024
          ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
          : `${(sizeBytes / 1024).toFixed(1)} KB`;
      setCacheStats({ count, size: sizeStr });
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    }
  }, []);

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await ipc.clearThumbnailCache();
      await loadCacheStats();
    } catch (error) {
      console.error('Failed to clear cache:', error);
    } finally {
      setClearingCache(false);
    }
  };

  useEffect(() => {
    if (settings.similarImagesEnableThumbnails) {
      loadCacheStats();
    }
  }, [settings.similarImagesEnableThumbnails, loadCacheStats]);

  return (
    <>
      {useLabelStyle ? (
        <div className="flex flex-wrap items-center gap-3">
          <FormItem name="similarImagesEnableThumbnails" comp="checkbox">
            <CheckboxWithLabel label={t('Enable thumbnails')} />
          </FormItem>
          <FormItem name="similarImagesShowImagePreview" comp="checkbox">
            <CheckboxWithLabel label={t('Show image preview')} />
          </FormItem>
          {settings.similarImagesEnableThumbnails && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearCache}
              disabled={clearingCache}
              className="h-8"
            >
              {t('Clear cache')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <FormItem name="similarImagesEnableThumbnails" comp="badge-switch">
            <TooltipButton tooltip={t('Enable thumbnails')}>
              <ToggleBadge>
                <ImageIcon className="h-4 w-4" />
              </ToggleBadge>
            </TooltipButton>
          </FormItem>
          <FormItem name="similarImagesShowImagePreview" comp="badge-switch">
            <TooltipButton tooltip={t('Show image preview')}>
              <ToggleBadge>
                <Eye className="h-4 w-4" />
              </ToggleBadge>
            </TooltipButton>
          </FormItem>
          {settings.similarImagesEnableThumbnails && (
            <TooltipButton
              tooltip={`${t('Clear cache')} (${cacheStats ? `${cacheStats.count} ${t('files')}, ${cacheStats.size}` : ''})`}
            >
              <Badge
                variant="outline"
                onClick={handleClearCache}
                className={cn(
                  'h-9 w-9 p-0 flex items-center justify-center cursor-pointer hover:bg-accent transition-colors',
                  clearingCache && 'opacity-50 cursor-wait',
                )}
              >
                <Trash2
                  className={cn('h-4 w-4', clearingCache && 'animate-pulse')}
                />
              </Badge>
            </TooltipButton>
          )}
        </div>
      )}
    </>
  );
}

// 通用视频设置组件
function VideoDisplaySettings({
  useLabelStyle = false,
}: {
  useLabelStyle?: boolean;
}) {
  const t = useT();

  if (useLabelStyle) {
    return (
      <FormItem name="similarVideosEnableThumbnails" comp="checkbox">
        <CheckboxWithLabel label={t('Enable video thumbnails')} />
      </FormItem>
    );
  }

  return (
    <FormItem name="similarVideosEnableThumbnails" comp="badge-switch">
      <TooltipButton tooltip={t('Enable video thumbnails')}>
        <ToggleBadge>
          <Video className="h-4 w-4" />
        </ToggleBadge>
      </TooltipButton>
    </FormItem>
  );
}

const toolsWithoutSettings = new Set<string>([
  // 移除所有工具，因为现在所有工具都有路径显示设置
]);

// 简单工具设置组件（只有路径显示选项）
function SimpleToolSettings() {
  return (
    <>
      <ImageDisplaySettings useLabelStyle />
      <PathDisplaySettings useLabelStyle />
    </>
  );
}

const settingsCompMap: Record<
  string,
  (props: {
    showControls?: boolean;
    showAlgorithms?: boolean;
  }) => React.JSX.Element
> = {
  [Tools.DuplicateFiles]: DuplicateFilesSettings,
  [Tools.BigFiles]: BigFilesSettings,
  [Tools.SimilarImages]: SimilarImagesSettings,
  [Tools.SimilarVideos]: SimilarVideosSettings,
  [Tools.MusicDuplicates]: MusicDuplicatesSettings,
  [Tools.BrokenFiles]: BrokenFilesSettings,
  [Tools.EmptyFolders]: SimpleToolSettings,
  [Tools.EmptyFiles]: SimpleToolSettings,
  [Tools.TemporaryFiles]: SimpleToolSettings,
  [Tools.InvalidSymlinks]: SimpleToolSettings,
  [Tools.BadExtensions]: SimpleToolSettings,
};

export function ToolSettings({
  inPanel = false,
  showControls = true,
  showAlgorithms = true,
}: {
  inPanel?: boolean;
  showControls?: boolean;
  showAlgorithms?: boolean;
}) {
  const currentTool = useAtomValue(currentToolAtom);
  const [settings, setSettings] = useAtom(settingsAtom);
  const dialogOpen = useBoolean();
  const t = useT();

  if (toolsWithoutSettings.has(currentTool)) {
    return null;
  }

  const descMap: Record<string, string> = {
    [Tools.DuplicateFiles]: t('Duplicate files settings'),
    [Tools.BigFiles]: t('Big files settings'),
    [Tools.SimilarImages]: t('Similar images settings'),
    [Tools.SimilarVideos]: t('Similar videos settings'),
    [Tools.MusicDuplicates]: t('Music duplicates settings'),
    [Tools.BrokenFiles]: t('Broken files settings'),
  };

  const desc = descMap[currentTool];

  const handleSettingsChange = (v: Record<string, any>) => {
    setSettings((old) => ({ ...old, ...v }));
  };

  const SettingsComponent = settingsCompMap[currentTool] || Fallback;

  const renderSettings = () => {
    if (!showControls && !showAlgorithms) {
      return null;
    }

    return (
      <Form
        value={settings}
        onChange={handleSettingsChange}
        className={inPanel ? 'space-y-3' : ''}
      >
        <SettingsComponent
          showControls={showControls}
          showAlgorithms={showAlgorithms}
        />
      </Form>
    );
  };

  if (inPanel) {
    return (
      <div className="w-full h-full overflow-auto p-2 hide-scrollbar">
        {renderSettings()}
      </div>
    );
  }

  return (
    <Dialog open={dialogOpen.value} onOpenChange={dialogOpen.set}>
      <DialogTrigger asChild>
        <OperationButton>
          <Settings2 />
          {t('Tool settings')}
        </OperationButton>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Tool settings')}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        {renderSettings()}
      </DialogContent>
    </Dialog>
  );
}

function Fallback() {
  return <div>Something wrong</div>;
}

function DuplicateFilesSettings({
  showControls = true,
  showAlgorithms = true,
}: {
  showControls?: boolean;
  showAlgorithms?: boolean;
}) {
  const t = useT();
  const settings = useAtomValue(settingsAtom);

  return (
    <>
      {showAlgorithms && (
        <>
          <FormItem
            name="duplicatesSubCheckMethod"
            label={t('Check method')}
            comp="select"
          >
            <Select
              options={[
                { label: t('Hash'), value: DuplicatesCheckMethod.Hash },
                { label: t('Name'), value: DuplicatesCheckMethod.Name },
                { label: t('Size'), value: DuplicatesCheckMethod.Size },
                {
                  label: t('Size and name'),
                  value: DuplicatesCheckMethod.SizeAndName,
                },
              ]}
            />
          </FormItem>
          <FormItem
            name="duplicatesSubAvailableHashType"
            label={t('Hash type')}
            comp="select"
          >
            <Select
              options={[
                { label: 'Blake3', value: DuplicatesAvailableHashType.Blake3 },
                { label: 'CRC32', value: DuplicatesAvailableHashType.CRC32 },
                { label: 'XXH3', value: DuplicatesAvailableHashType.XXH3 },
              ]}
            />
          </FormItem>
        </>
      )}
      {showControls && (
        <>
          {showAlgorithms ? (
            <FormItem name="duplicatesSubNameCaseSensitive" comp="badge-switch">
              <TooltipButton tooltip={t('Case sensitive')}>
                <ToggleBadge>
                  <CaseSensitive className="h-4 w-4" />
                </ToggleBadge>
              </TooltipButton>
            </FormItem>
          ) : (
            <FormItem name="duplicatesSubNameCaseSensitive" comp="checkbox">
              <CheckboxWithLabel label={t('Case sensitive')} />
            </FormItem>
          )}
          <FormItem
            name="duplicateGroupSizeThreshold"
            label={t('Min group size')}
            comp="slider"
            suffix={<span>≥{settings.duplicateGroupSizeThreshold}</span>}
          >
            <Slider min={1} max={10} />
          </FormItem>
        </>
      )}
      <ImageDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
      <PathDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
    </>
  );
}

function BigFilesSettings({
  showControls = true,
  showAlgorithms = true,
}: {
  showControls?: boolean;
  showAlgorithms?: boolean;
}) {
  const t = useT();

  return (
    <>
      {showAlgorithms && (
        <FormItem
          name="biggestFilesSubMethod"
          label={t('Checked files')}
          comp="select"
        >
          <Select
            options={[
              { label: t('Biggest'), value: BigFilesSearchMode.BiggestFiles },
              { label: t('Smallest'), value: BigFilesSearchMode.SmallestFiles },
            ]}
          />
        </FormItem>
      )}
      {showControls && (
        <FormItem
          name="biggestFilesSubNumberOfFiles"
          label={t('Number of lines')}
          comp="input-number"
        >
          <InputNumber minValue={1} />
        </FormItem>
      )}
      <ImageDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
      <PathDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
    </>
  );
}

function SimilarImagesSettings({
  showControls = true,
  showAlgorithms = true,
}: {
  showControls?: boolean;
  showAlgorithms?: boolean;
}) {
  const settings = useAtomValue(settingsAtom);
  const setSettings = useSetAtom(settingsAtom);
  const [presets, setPresets] = useAtom(similarImagesPresetsAtom);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [newPresetName, setNewPresetName] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const t = useT();

  useEffect(() => {
    if (!presets.length) {
      setSelectedPresetId('');
      return;
    }
    if (!presets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId(presets[0].id);
    }
  }, [presets, selectedPresetId]);

  const buildCurrentPresetConfig = (): SimilarImagesPresetConfig => ({
    similarImagesSubHashSize: settings.similarImagesSubHashSize,
    similarImagesSubHashAlg: settings.similarImagesSubHashAlg,
    similarImagesSubResizeAlgorithm: settings.similarImagesSubResizeAlgorithm,
    similarImagesSubSimilarity: settings.similarImagesSubSimilarity,
    similarImagesSubIgnoreSameSize: settings.similarImagesSubIgnoreSameSize,
    similarImagesFolderThreshold: settings.similarImagesFolderThreshold,
  });

  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name) {
      return;
    }
    const config = buildCurrentPresetConfig();
    let savedPresetId = '';

    setPresets((prev) => {
      const existing = prev.find((preset) => preset.name === name);
      if (existing) {
        savedPresetId = existing.id;
        return prev.map((preset) =>
          preset.id === existing.id ? { ...preset, config } : preset,
        );
      }
      const created = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        config,
      };
      savedPresetId = created.id;
      return [...prev, created];
    });

    if (savedPresetId) {
      setSelectedPresetId(savedPresetId);
    }
    setNewPresetName('');
    setSaveDialogOpen(false);
  };

  const applyPresetById = (presetId: string) => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setSettings((prev) => ({ ...prev, ...preset.config }));
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    applyPresetById(presetId);
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) {
      return;
    }
    setPresets((prev) =>
      prev.filter((preset) => preset.id !== selectedPresetId),
    );
  };

  return (
    <>
      {showAlgorithms && (
        <div className="rounded border border-border p-2">
          <div className="flex w-full items-center gap-2 min-w-0 flex-wrap">
            <div className="flex-1 min-w-40">
              <Select
                value={selectedPresetId}
                onChange={handlePresetChange}
                options={presets.map((preset) => ({
                  label: preset.name,
                  value: preset.id,
                }))}
                placeholder={t('NoPreset')}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              disabled
              className="h-9 w-9 shrink-0 p-0 text-green-600"
              title={t('Auto apply')}
            >
              <span className="sr-only">{t('Auto apply')}</span>
              <Settings2 className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setSaveDialogOpen(true)}
              className="h-9 w-9 shrink-0 p-0"
              title={t('Add preset')}
            >
              <span className="sr-only">{t('Add preset')}</span>
              <Save className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleDeletePreset}
              disabled={!selectedPresetId}
              className="h-9 w-9 shrink-0 p-0"
              title={t('Remove preset')}
            >
              <span className="sr-only">{t('Remove preset')}</span>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('Add preset')}</DialogTitle>
                <DialogDescription>{t('New preset name')}</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={newPresetName}
                  onChange={(event) =>
                    setNewPresetName(event.currentTarget.value)
                  }
                  placeholder={t('New preset name')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSavePreset();
                    }
                  }}
                />
                <Button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={!newPresetName.trim()}
                >
                  {t('Save')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {showAlgorithms && (
        <>
          <FormItem
            name="similarImagesSubHashSize"
            label={t('Hash size')}
            comp="select"
          >
            <Select
              options={['8', '16', '32', '64'].map((value) => ({
                label: value,
                value,
              }))}
            />
          </FormItem>
          <FormItem
            name="similarImagesSubResizeAlgorithm"
            label={t('Resize algorithm')}
            comp="select"
          >
            <Select
              options={Object.values(SimilarImagesResizeAlgorithm).map(
                (value) => ({
                  label: value,
                  value,
                }),
              )}
            />
          </FormItem>
          <FormItem
            name="similarImagesSubHashAlg"
            label={t('Hash type')}
            comp="select"
          >
            <Select
              options={Object.values(SimilarImagesHashAlgorithm).map(
                (value) => ({
                  label: value,
                  value,
                }),
              )}
            />
          </FormItem>
        </>
      )}
      {showControls && (
        <>
          <FormItem
            name="similarImagesSubSimilarity"
            label={t('Max difference')}
            comp="slider"
            suffix={<span>({settings.similarImagesSubSimilarity}/40)</span>}
          >
            <Slider min={0} max={40} />
          </FormItem>
          <FormItem
            name="similarImagesFolderThreshold"
            label="文件夹阈值"
            comp="slider"
            suffix={<span>{settings.similarImagesFolderThreshold} </span>}
          >
            <Slider min={1} max={50} />
          </FormItem>
          {showAlgorithms ? (
            <FormItem name="similarImagesSubIgnoreSameSize" comp="badge-switch">
              <TooltipButton tooltip={t('Ignore same size')}>
                <ToggleBadge>
                  <Ruler className="h-4 w-4" />
                </ToggleBadge>
              </TooltipButton>
            </FormItem>
          ) : (
            <FormItem name="similarImagesSubIgnoreSameSize" comp="checkbox">
              <CheckboxWithLabel label={t('Ignore same size')} />
            </FormItem>
          )}
        </>
      )}
      <ImageDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
      {showAlgorithms && <PathDisplaySettings useLabelStyle={!showControls} />}
    </>
  );
}

function SimilarVideosSettings({
  showControls = true,
  showAlgorithms = true,
}: {
  showControls?: boolean;
  showAlgorithms?: boolean;
}) {
  const settings = useAtomValue(settingsAtom);
  const t = useT();

  return (
    <>
      {showControls && (
        <>
          <FormItem
            name="similarVideosSubSimilarity"
            label={t('Max difference')}
            comp="slider"
            suffix={<span>({settings.similarVideosSubSimilarity}/20)</span>}
          >
            <Slider min={0} max={20} />
          </FormItem>
          {showAlgorithms ? (
            <FormItem name="similarVideosSubIgnoreSameSize" comp="badge-switch">
              <TooltipButton tooltip={t('Ignore same size')}>
                <ToggleBadge>
                  <Ruler className="h-4 w-4" />
                </ToggleBadge>
              </TooltipButton>
            </FormItem>
          ) : (
            <FormItem name="similarVideosSubIgnoreSameSize" comp="checkbox">
              <CheckboxWithLabel label={t('Ignore same size')} />
            </FormItem>
          )}
          <FormItem
            name="similarVideosSkipForwardAmount"
            label={t('Skip forward (s)')}
            description={t('Skip forward desc')}
            comp="slider"
            suffix={<span>{settings.similarVideosSkipForwardAmount}s</span>}
          >
            <Slider min={0} max={300} />
          </FormItem>
          <FormItem
            name="similarVideosVidHashDuration"
            label={t('Hash duration (s)')}
            description={t('Hash duration desc')}
            comp="slider"
            suffix={<span>{settings.similarVideosVidHashDuration}s</span>}
          >
            <Slider min={2} max={60} />
          </FormItem>
          <FormItem
            name="similarVideosCropDetect"
            label={t('Crop detect')}
            description={t('Crop detect desc')}
            comp="select"
          >
            <Select
              options={[
                { label: t('Letterbox'), value: 'letterbox' },
                { label: t('Motion'), value: 'motion' },
                { label: t('None'), value: 'none' },
              ]}
            />
          </FormItem>
        </>
      )}
      <VideoDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
      <PathDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
    </>
  );
}

function MusicDuplicatesSettings({
  showControls = true,
  showAlgorithms = true,
}: {
  showControls?: boolean;
  showAlgorithms?: boolean;
}) {
  const settings = useAtomValue(settingsAtom);
  const t = useT();

  return (
    <>
      {showAlgorithms && (
        <FormItem
          name="similarMusicSubAudioCheckType"
          label={t('Audio check type')}
          comp="select"
        >
          <Select
            options={Object.values(SimilarMusicAudioCheckType).map((value) => ({
              label: t(value),
              value,
            }))}
          />
        </FormItem>
      )}
      {showControls &&
        settings.similarMusicSubAudioCheckType ===
          SimilarMusicAudioCheckType.Tags && (
          <>
            {showAlgorithms ? (
              <FormItem
                name="similarMusicSubApproximateComparison"
                comp="badge-switch"
              >
                <TooltipButton tooltip={t('Approximate tag comparison')}>
                  <ToggleBadge>
                    <SearchCode className="h-4 w-4" />
                  </ToggleBadge>
                </TooltipButton>
              </FormItem>
            ) : (
              <FormItem
                name="similarMusicSubApproximateComparison"
                comp="checkbox"
              >
                <CheckboxWithLabel label={t('Approximate tag comparison')} />
              </FormItem>
            )}
            <span className="text-center">{t('Compared tags')}</span>
            <div className="grid grid-cols-3 gap-2 *:pl-4">
              <FormItem name="similarMusicSubTitle" comp="checkbox">
                <CheckboxWithLabel label={t('Title')} />
              </FormItem>
              <FormItem name="similarMusicSubArtist" comp="checkbox">
                <CheckboxWithLabel label={t('Artist')} />
              </FormItem>
              <FormItem name="similarMusicSubBitrate" comp="checkbox">
                <CheckboxWithLabel label={t('Bitrate')} />
              </FormItem>
              <FormItem name="similarMusicSubGenre" comp="checkbox">
                <CheckboxWithLabel label={t('Genre')} />
              </FormItem>
              <FormItem name="similarMusicSubYear" comp="checkbox">
                <CheckboxWithLabel label={t('Year')} />
              </FormItem>
              <FormItem name="similarMusicSubLength" comp="checkbox">
                <CheckboxWithLabel label={t('Length')} />
              </FormItem>
            </div>
          </>
        )}
      {showControls &&
        settings.similarMusicSubAudioCheckType ===
          SimilarMusicAudioCheckType.Fingerprint && (
          <>
            <FormItem
              name="similarMusicSubMaximumDifferenceValue"
              label={t('Max difference')}
              comp="slider"
              suffix={
                <span>
                  ({settings.similarMusicSubMaximumDifferenceValue}/10)
                </span>
              }
            >
              <Slider min={0} max={10} />
            </FormItem>
            <FormItem
              name="similarMusicSubMinimalFragmentDurationValue"
              label={t('Minimal fragment duration')}
              comp="slider"
              suffix={
                <span>
                  {settings.similarMusicSubMinimalFragmentDurationValue}
                </span>
              }
            >
              <Slider min={0} max={180} />
            </FormItem>
            {showAlgorithms ? (
              <FormItem
                name="similarMusicCompareFingerprintsOnlyWithSimilarTitles"
                comp="badge-switch"
              >
                <TooltipButton tooltip={t('Compare only with similar titles')}>
                  <ToggleBadge>
                    <FileType className="h-4 w-4" />
                  </ToggleBadge>
                </TooltipButton>
              </FormItem>
            ) : (
              <FormItem
                name="similarMusicCompareFingerprintsOnlyWithSimilarTitles"
                comp="checkbox"
              >
                <CheckboxWithLabel
                  label={t('Compare only with similar titles')}
                />
              </FormItem>
            )}
          </>
        )}
      <ImageDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
      <PathDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
    </>
  );
}

function BrokenFilesSettings({
  showControls = true,
  showAlgorithms = true,
}: {
  showControls?: boolean;
  showAlgorithms?: boolean;
}) {
  const t = useT();

  return (
    <>
      {showControls && (
        <>
          {showAlgorithms ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <FormItem name="brokenFilesSubAudio" comp="badge-switch">
                <TooltipButton tooltip={t('Audio')}>
                  <ToggleBadge>
                    <FileAudio className="h-4 w-4" />
                  </ToggleBadge>
                </TooltipButton>
              </FormItem>
              <FormItem name="brokenFilesSubPdf" comp="badge-switch">
                <TooltipButton tooltip={t('Pdf')}>
                  <ToggleBadge>
                    <FileArchive className="h-4 w-4" />
                  </ToggleBadge>
                </TooltipButton>
              </FormItem>
              <FormItem name="brokenFilesSubArchive" comp="badge-switch">
                <TooltipButton tooltip={t('Archive')}>
                  <ToggleBadge>
                    <FileArchive className="h-4 w-4" />
                  </ToggleBadge>
                </TooltipButton>
              </FormItem>
              <FormItem name="brokenFilesSubImage" comp="badge-switch">
                <TooltipButton tooltip={t('Image')}>
                  <ToggleBadge>
                    <FileImage className="h-4 w-4" />
                  </ToggleBadge>
                </TooltipButton>
              </FormItem>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 pt-2">
              <FormItem name="brokenFilesSubAudio" comp="checkbox">
                <CheckboxWithLabel label={t('Audio')} />
              </FormItem>
              <FormItem name="brokenFilesSubPdf" comp="checkbox">
                <CheckboxWithLabel label={t('Pdf')} />
              </FormItem>
              <FormItem name="brokenFilesSubArchive" comp="checkbox">
                <CheckboxWithLabel label={t('Archive')} />
              </FormItem>
              <FormItem name="brokenFilesSubImage" comp="checkbox">
                <CheckboxWithLabel label={t('Image')} />
              </FormItem>
            </div>
          )}
        </>
      )}
      <ImageDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
      <PathDisplaySettings useLabelStyle={showControls !== showAlgorithms} />
    </>
  );
}
