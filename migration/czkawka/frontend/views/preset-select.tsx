import { readText, writeText } from '@/nodes/czkawka/upstream/adapters/tauri-clipboard';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  Download,
  FilePenLine,
  FilePlus,
  TimerReset,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { currentPresetAtom } from '@/nodes/czkawka/upstream/atom/preset';
import {
  excludedDirsRowSelectionAtom,
  includedDirsRowSelectionAtom,
  platformSettingsAtom,
  presetsAtom,
} from '@/nodes/czkawka/upstream/atom/primitive';
import {
  EditInput,
  Label,
  Select,
  TooltipButton,
  toastError,
} from '@/nodes/czkawka/upstream/components';
import { getDefaultSettings } from '@/nodes/czkawka/upstream/consts';
import { useBoolean, useT } from '@/nodes/czkawka/upstream/hooks';
import type { Preset } from '@/nodes/czkawka/upstream/types';

interface PresetSelectProps {
  onPreventDialogCloseChange: (open: boolean) => void;
}

export function PresetSelect(props: PresetSelectProps) {
  const { onPreventDialogCloseChange } = props;

  const [presets, setPresets] = useAtom(presetsAtom);
  const platformSettings = useAtomValue(platformSettingsAtom);
  const [currentPreset, setCurrentPreset] = useAtom(currentPresetAtom);
  const setIncludedDirsRowSelection = useSetAtom(includedDirsRowSelectionAtom);
  const setExcludedDirsRowSelection = useSetAtom(excludedDirsRowSelectionAtom);
  const newPresetInputVisible = useBoolean();
  const editPresetInputVisible = useBoolean();
  const [importExportLoading, setImportExportLoading] = useState(false);
  const t = useT();

  const handlePresetSelect = (name: string) => {
    setPresets(
      presets.map((preset) => {
        if (preset.name === name) {
          return { ...preset, active: true };
        }
        return { ...preset, active: false };
      }),
    );
  };

  const handleAddOrEditPresetCancel = () => {
    newPresetInputVisible.off();
    editPresetInputVisible.off();
    onPreventDialogCloseChange(false);
  };

  const handleAddPresetOk = (name: string) => {
    setPresets([
      ...presets.map((preset) => {
        return { ...preset, active: false };
      }),
      {
        name,
        active: true,
        changed: false,
        settings: {
          ...getDefaultSettings(),
          ...platformSettings,
          threadNumber: platformSettings.availableThreadNumber,
        },
      },
    ]);
    handleAddOrEditPresetCancel();
  };

  const handleNamingPresetValidate = (name: string) => {
    if (presets.some((preset) => preset.name === name)) {
      onPreventDialogCloseChange(false);
      return t('Name already exists', { name });
    }
  };

  const handleEditPresetNameOk = (name: string) => {
    setCurrentPreset({ name });
    handleAddOrEditPresetCancel();
  };

  const handlePresetRemove = () => {
    const newPresets = presets.filter((preset) => !preset.active);
    newPresets[0].active = true;
    setPresets(newPresets);
  };

  const handleSettingsReset = () => {
    setCurrentPreset({
      settings: {
        ...getDefaultSettings(),
        ...platformSettings,
        threadNumber: platformSettings.availableThreadNumber,
      },
    });
    setIncludedDirsRowSelection({});
    setExcludedDirsRowSelection({});
  };

  const handleExportPreset = async () => {
    try {
      setImportExportLoading(true);

      // 将预设数据序列化为 JSON
      const presetData = JSON.stringify(
        {
          name: currentPreset.name,
          settings: currentPreset.settings,
        },
        null,
        2,
      );

      // 写入剪贴板
      await writeText(presetData);
      toast.success(t('Preset exported successfully'));
    } catch (error) {
      toastError(t('Failed to export preset'), error);
    } finally {
      setImportExportLoading(false);
    }
  };

  const handleImportPreset = async () => {
    try {
      setImportExportLoading(true);

      // 从剪贴板读取数据
      const clipboardText = await readText();
      if (!clipboardText) {
        toast.error('Clipboard is empty');
        return;
      }

      // 尝试解析 JSON
      let importedData: any;
      try {
        importedData = JSON.parse(clipboardText);
      } catch (_e) {
        toast.error('Invalid JSON format in clipboard');
        return;
      }

      // 验证数据格式
      if (!importedData.name || !importedData.settings) {
        toast.error('Invalid preset format');
        return;
      }

      // 创建新预设
      const newPreset: Preset = {
        name: importedData.name,
        active: false,
        changed: false,
        settings: {
          ...getDefaultSettings(),
          ...importedData.settings,
        },
      };

      // 检查名称是否已存在，如果存在则添加数字后缀
      let presetName = newPreset.name;
      let counter = 1;
      while (presets.some((p) => p.name === presetName)) {
        presetName = `${newPreset.name} (${counter})`;
        counter++;
      }

      // 添加导入的预设
      setPresets([
        ...presets.map((preset) => ({ ...preset, active: false })),
        {
          ...newPreset,
          name: presetName,
          active: true,
          changed: true,
        },
      ]);

      toast.success(t('Preset imported successfully'));
    } catch (error) {
      toastError(t('Failed to import preset'), error);
    } finally {
      setImportExportLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1 pb-2 border-b">
      <Label>{t('Current preset')}:</Label>
      {!(newPresetInputVisible.value || editPresetInputVisible.value) && (
        <Select
          name="presetSelect"
          value={currentPreset.name}
          onChange={handlePresetSelect}
          onPreventDialogCloseChange={onPreventDialogCloseChange}
          options={presets.map((preset) => {
            return { label: preset.name, value: preset.name };
          })}
        />
      )}
      {newPresetInputVisible.value && (
        <EditInput
          className="flex-1"
          placeholder={t('New preset name')}
          name="newPresetName"
          onOk={handleAddPresetOk}
          onValidate={handleNamingPresetValidate}
          onCancel={handleAddOrEditPresetCancel}
        />
      )}
      {editPresetInputVisible.value && (
        <EditInput
          className="flex-1"
          placeholder={currentPreset.name}
          initValue={currentPreset.name}
          name="editPresetName"
          onOk={handleEditPresetNameOk}
          onValidate={handleNamingPresetValidate}
          onCancel={handleAddOrEditPresetCancel}
          selectAllWhenMounted
        />
      )}
      <span>
        <TooltipButton
          tooltip={t('Add preset')}
          onClick={() => {
            newPresetInputVisible.on();
            onPreventDialogCloseChange(true);
          }}
          disabled={editPresetInputVisible.value}
        >
          <FilePlus />
        </TooltipButton>
        <TooltipButton
          tooltip={t('Edit name')}
          onClick={() => {
            editPresetInputVisible.on();
            onPreventDialogCloseChange(true);
          }}
          disabled={newPresetInputVisible.value}
        >
          <FilePenLine />
        </TooltipButton>
        <TooltipButton
          tooltip={t('Remove preset')}
          onClick={handlePresetRemove}
          disabled={
            presets.length === 1 ||
            newPresetInputVisible.value ||
            editPresetInputVisible.value ||
            importExportLoading
          }
        >
          <Trash2 />
        </TooltipButton>
        <TooltipButton
          tooltip={t('Reset settings')}
          onClick={handleSettingsReset}
          disabled={importExportLoading}
        >
          <TimerReset />
        </TooltipButton>
        <TooltipButton
          tooltip="Export preset to clipboard"
          onClick={handleExportPreset}
          disabled={
            newPresetInputVisible.value ||
            editPresetInputVisible.value ||
            importExportLoading
          }
        >
          <Download />
        </TooltipButton>
        <TooltipButton
          tooltip="Import preset from clipboard"
          onClick={handleImportPreset}
          disabled={
            newPresetInputVisible.value ||
            editPresetInputVisible.value ||
            importExportLoading
          }
        >
          <Upload />
        </TooltipButton>
      </span>
    </div>
  );
}
