/**
 * DirectorySelectionCard - 目录选择卡片
 * 封装 DirectorySelectionSection 组件
 */
import { DirectorySelectionSection } from '@/nodes/czkawka/upstream/views/selection-assistant/directory-selection-section';

export function DirectorySelectionCard() {
  return (
    <div className="p-2">
      <DirectorySelectionSection />
    </div>
  );
}
