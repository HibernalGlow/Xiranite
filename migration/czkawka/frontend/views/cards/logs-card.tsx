/**
 * LogsCard - 日志卡片
 * 显示扫描日志
 */
import { useAtomValue } from 'jotai';
import { logsAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { ScrollArea } from '@/nodes/czkawka/upstream/components';

export function LogsCard() {
  const logs = useAtomValue(logsAtom);

  return (
    <ScrollArea className="h-full px-2 py-1 hide-scrollbar">
      <div className="whitespace-break-spaces text-sm">{logs}</div>
    </ScrollArea>
  );
}
