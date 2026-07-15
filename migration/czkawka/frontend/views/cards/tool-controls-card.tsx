/**
 * ToolControlsCard - 工具控制卡片
 * 显示当前工具的控制选项
 */
import { ToolSettings } from '@/nodes/czkawka/upstream/views/tool-settings';

export function ToolControlsCard() {
  return (
    <div className="p-2 overflow-auto hide-scrollbar">
      <ToolSettings inPanel={true} showControls={true} showAlgorithms={false} />
    </div>
  );
}
