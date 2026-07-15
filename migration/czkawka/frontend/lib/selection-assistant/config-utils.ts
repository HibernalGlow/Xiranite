/**
 * 选择助手配置导入/导出工具
 * 使用 zod 进行配置验证
 */

import { importConfigSchema } from './schemas';
import type {
  DirectoryRuleConfig,
  ExportConfig,
  GroupRuleConfig,
  TextRuleConfig,
} from './types';

/** 当前配置版本 */
export const CONFIG_VERSION = '1.0.0';

/** 导出配置结果 */
export interface ExportResult {
  success: boolean;
  data?: string;
  error?: string;
}

/** 导入配置结果 */
export interface ImportResult {
  success: boolean;
  config?: ExportConfig;
  errors?: string[];
}

/**
 * 导出配置为 JSON 字符串
 * @param config 要导出的配置
 * @returns 导出结果
 */
export function exportConfig(config: {
  groupRule?: GroupRuleConfig;
  textRule?: TextRuleConfig;
  directoryRule?: DirectoryRuleConfig;
}): ExportResult {
  try {
    const exportData: ExportConfig = {
      version: CONFIG_VERSION,
      ...config,
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    return { success: true, data: jsonString };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '导出配置失败',
    };
  }
}

/**
 * 从 JSON 字符串导入配置
 * @param jsonString JSON 字符串
 * @returns 导入结果
 */
export function importConfig(jsonString: string): ImportResult {
  try {
    // 解析 JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      return {
        success: false,
        errors: ['无效的 JSON 格式'],
      };
    }

    // 使用 zod 验证
    const result = importConfigSchema.safeParse(parsed);

    if (!result.success) {
      const errors = result.error.issues.map((err) => {
        const path = err.path.join('.');
        return path ? `${path}: ${err.message}` : err.message;
      });
      return { success: false, errors };
    }

    return { success: true, config: result.data };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : '导入配置失败'],
    };
  }
}

/**
 * 下载配置文件
 * @param config 要导出的配置
 * @param filename 文件名（不含扩展名）
 */
export function downloadConfig(
  config: {
    groupRule?: GroupRuleConfig;
    textRule?: TextRuleConfig;
    directoryRule?: DirectoryRuleConfig;
  },
  filename = 'selection-assistant-config',
): void {
  const result = exportConfig(config);
  if (!result.success || !result.data) {
    console.error('导出配置失败:', result.error);
    return;
  }

  const blob = new Blob([result.data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 从文件读取配置
 * @param file 文件对象
 * @returns Promise<ImportResult>
 */
export async function readConfigFromFile(file: File): Promise<ImportResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== 'string') {
        resolve({ success: false, errors: ['无法读取文件内容'] });
        return;
      }
      resolve(importConfig(content));
    };

    reader.onerror = () => {
      resolve({ success: false, errors: ['读取文件失败'] });
    };

    reader.readAsText(file);
  });
}

/**
 * 验证配置版本兼容性
 * @param version 配置版本
 * @returns 是否兼容
 */
export function isVersionCompatible(version: string): boolean {
  // 目前只支持 1.x.x 版本
  const [major] = version.split('.');
  const [currentMajor] = CONFIG_VERSION.split('.');
  return major === currentMajor;
}

/**
 * 合并配置（用于部分导入）
 * @param current 当前配置
 * @param imported 导入的配置
 * @returns 合并后的配置
 */
export function mergeConfigs(
  current: {
    groupRule: GroupRuleConfig;
    textRule: TextRuleConfig;
    directoryRule: DirectoryRuleConfig;
  },
  imported: ExportConfig,
): {
  groupRule: GroupRuleConfig;
  textRule: TextRuleConfig;
  directoryRule: DirectoryRuleConfig;
} {
  return {
    groupRule: imported.groupRule ?? current.groupRule,
    textRule: imported.textRule ?? current.textRule,
    directoryRule: imported.directoryRule ?? current.directoryRule,
  };
}
