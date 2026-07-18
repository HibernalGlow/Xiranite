/**
 * AlgorithmSettingsCard - 算法设置卡片
 * 显示当前工具的算法设置选项
 */
import { ToolSettings } from '@/nodes/czkawka/upstream/views/tool-settings';

export function AlgorithmSettingsCard() {
  return (
    <div className="p-2 overflow-auto hide-scrollbar">
      <ToolSettings inPanel={true} showControls={false} showAlgorithms={true} />
    </div>
  );
}
