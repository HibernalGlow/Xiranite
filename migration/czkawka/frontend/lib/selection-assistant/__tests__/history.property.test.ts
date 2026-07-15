/**
 * 历史管理属性测试
 * Property 12: 撤销/重做往返一致性
 * Validates: Requirements 5.2, 5.3
 */

import type { RowSelectionState } from '@tanstack/react-table';
import * as fc from 'fast-check';
import { atom, createStore } from 'jotai';
import { REDO, UNDO, withHistory } from 'jotai-history';
import { describe, it } from 'vitest';

describe('历史管理属性测试', () => {
  // Property 12: 撤销/重做往返一致性
  describe('Property 12: 撤销/重做往返一致性', () => {
    it('执行操作后撤销应该恢复到之前的状态', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (paths1, paths2) => {
            // 每次迭代创建新的 store 和 atoms
            const store = createStore();
            const baseAtom = atom<RowSelectionState>({});
            const historyAtom = withHistory(baseAtom, 50);

            // 设置初始状态
            const state1: RowSelectionState = {};
            for (const path of paths1) {
              state1[path] = true;
            }
            store.set(baseAtom, state1);

            // 获取初始状态（从历史数组的第一个元素）
            const historyAfterFirst = store.get(historyAtom);
            const initialState = historyAfterFirst[0];

            // 设置新状态
            const state2: RowSelectionState = {};
            for (const path of paths2) {
              state2[path] = true;
            }
            store.set(baseAtom, state2);

            // 撤销
            store.set(historyAtom, UNDO);

            // 验证恢复到初始状态
            const historyAfterUndo = store.get(historyAtom);
            const afterUndo = historyAfterUndo[0];
            return JSON.stringify(afterUndo) === JSON.stringify(initialState);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('撤销后重做应该恢复到撤销前的状态', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 10,
          }),
          (paths1, paths2) => {
            const store = createStore();
            const baseAtom = atom<RowSelectionState>({});
            const historyAtom = withHistory(baseAtom, 50);

            // 设置初始状态
            const state1: RowSelectionState = {};
            for (const path of paths1) {
              state1[path] = true;
            }
            store.set(baseAtom, state1);

            // 设置新状态
            const state2: RowSelectionState = {};
            for (const path of paths2) {
              state2[path] = true;
            }
            store.set(baseAtom, state2);

            // 获取新状态
            const historyBeforeUndo = store.get(historyAtom);
            const beforeUndo = historyBeforeUndo[0];

            // 撤销
            store.set(historyAtom, UNDO);

            // 重做
            store.set(historyAtom, REDO);

            // 验证恢复到撤销前的状态
            const historyAfterRedo = store.get(historyAtom);
            const afterRedo = historyAfterRedo[0];
            return JSON.stringify(afterRedo) === JSON.stringify(beforeUndo);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
