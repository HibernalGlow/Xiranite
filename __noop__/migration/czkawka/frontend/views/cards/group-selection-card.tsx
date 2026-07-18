/**
 * GroupSelectionCard - 组选择卡片
 * 封装 GroupSelectionSection 组件
 */
import { GroupSelectionSection } from '@/nodes/czkawka/upstream/views/selection-assistant/group-selection-section';

export function GroupSelectionCard() {
  return (
    <div className="p-2">
      <GroupSelectionSection />
    </div>
  );
}
