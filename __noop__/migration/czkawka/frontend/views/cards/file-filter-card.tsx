/**
 * FileFilterCard - 文件过滤器卡片
 * 封装 FileFilterContent 组件
 */
import { FileFilterContent } from '@/nodes/czkawka/upstream/views/file-filter-content';

export function FileFilterCard() {
  return (
    <div className="p-2 overflow-auto">
      <FileFilterContent />
    </div>
  );
}
