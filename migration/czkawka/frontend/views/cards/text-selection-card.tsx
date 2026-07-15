/**
 * TextSelectionCard - 文本选择卡片
 * 封装 TextSelectionSection 组件
 */
import { TextSelectionSection } from '@/nodes/czkawka/upstream/views/selection-assistant/text-selection-section';

export function TextSelectionCard() {
  return (
    <div className="p-2">
      <TextSelectionSection />
    </div>
  );
}
