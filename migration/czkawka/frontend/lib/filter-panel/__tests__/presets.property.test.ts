/**
 * 预设属性测试
 * Presets Property Tests
 *
 * **Property 6: 预设应用正确性**
 * **Validates: Requirements 5.3**
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  defaultFilterState,
  presetConfigs,
  resetFilterState,
} from '../presets';
import type { FilterPreset, FilterState } from '../types';

describe('Filter Presets - Property Tests', () => {
  const presets: FilterPreset[] = [
    'none',
    'largeFilesFirst',
    'smallFilesFirst',
    'recentlyModified',
    'oldFiles',
  ];

  /**
   * Property 6: 预设应用正确性
   * For any 预设 P，应用预设后的过滤状态应该与预设定义的配置一致
   */
  describe('Property 6: Preset Application Correctness', () => {
    it('should apply preset configuration correctly', () => {
      fc.assert(
        fc.property(fc.constantFrom(...presets), (preset) => {
          const result = applyPreset(defaultFilterState, preset);

          // 预设字段应该正确设置
          expect(result.preset).toBe(preset);

          if (preset === 'none') {
            // none 预设应该重置到默认状态
            expect(result.fileSize.enabled).toBe(false);
            expect(result.modifiedDate.enabled).toBe(false);
          } else {
            // 其他预设应该应用对应的配置
            const presetConfig = presetConfigs[preset];

            if (presetConfig.fileSize) {
              expect(result.fileSize.enabled).toBe(
                presetConfig.fileSize.enabled,
              );
              expect(result.fileSize.min).toBe(presetConfig.fileSize.min);
              expect(result.fileSize.max).toBe(presetConfig.fileSize.max);
            }

            if (presetConfig.modifiedDate) {
              expect(result.modifiedDate.enabled).toBe(
                presetConfig.modifiedDate.enabled,
              );
              expect(result.modifiedDate.preset).toBe(
                presetConfig.modifiedDate.preset,
              );
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('should preserve showAllInFilteredGroups default value', () => {
      fc.assert(
        fc.property(fc.constantFrom(...presets), (preset) => {
          const result = applyPreset(defaultFilterState, preset);
          // showAllInFilteredGroups 应该保持默认值 true
          expect(result.showAllInFilteredGroups).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('should reset non-preset filters to default', () => {
      fc.assert(
        fc.property(fc.constantFrom(...presets), (preset) => {
          // 创建一个修改过的状态
          const modifiedState: FilterState = {
            ...defaultFilterState,
            markStatus: { enabled: true, options: ['marked'] },
            groupCount: { enabled: true, min: 5, max: 50 },
          };

          const result = applyPreset(modifiedState, preset);

          // 非预设相关的过滤器应该重置到默认值
          expect(result.markStatus.enabled).toBe(false);
          expect(result.groupCount.enabled).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('resetFilterState', () => {
    it('should return a fresh copy of default state', () => {
      const state1 = resetFilterState();
      const state2 = resetFilterState();

      // 应该是不同的对象引用
      expect(state1).not.toBe(state2);

      // 但内容应该相同
      expect(state1).toEqual(state2);
      expect(state1).toEqual(defaultFilterState);
    });
  });

  describe('Preset configurations', () => {
    it('largeFilesFirst should filter files > 100MB', () => {
      const result = applyPreset(defaultFilterState, 'largeFilesFirst');
      expect(result.fileSize.enabled).toBe(true);
      expect(result.fileSize.min).toBe(100 * 1024 * 1024);
    });

    it('smallFilesFirst should filter files < 1MB', () => {
      const result = applyPreset(defaultFilterState, 'smallFilesFirst');
      expect(result.fileSize.enabled).toBe(true);
      expect(result.fileSize.max).toBe(1 * 1024 * 1024);
    });

    it('recentlyModified should use last30days preset', () => {
      const result = applyPreset(defaultFilterState, 'recentlyModified');
      expect(result.modifiedDate.enabled).toBe(true);
      expect(result.modifiedDate.preset).toBe('last30days');
    });

    it('oldFiles should filter files older than 1 year', () => {
      const result = applyPreset(defaultFilterState, 'oldFiles');
      expect(result.modifiedDate.enabled).toBe(true);
      expect(result.modifiedDate.preset).toBe('custom');
      expect(result.modifiedDate.endDate).toBeLessThan(Date.now());
    });
  });
});
