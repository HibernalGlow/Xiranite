import { useAtom, useSetAtom } from 'jotai';
import { TextCursorInput } from 'lucide-react';
import { Trans } from 'react-i18next';
import { logsAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { currentToolDataAtom, currentToolRowSelectionAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { OperationButton } from '@/nodes/czkawka/upstream/components';
import { OneAlertDialog } from '@/nodes/czkawka/upstream/components/one-alert-dialog';
import { useBoolean, useListenEffect, useT } from '@/nodes/czkawka/upstream/hooks';
import { ipc } from '@/nodes/czkawka/upstream/ipc';
import { getRowSelectionKeys } from '@/nodes/czkawka/upstream/utils/common';

interface RenameExtProps {
  disabled: boolean;
}

interface RenameExtResult {
  successPaths: string[];
  errors: string[];
}

export function RenameExt(props: RenameExtProps) {
  const { disabled } = props;

  const open = useBoolean();
  const loading = useBoolean();
  const setLogs = useSetAtom(logsAtom);
  const [currentToolData, setCurrentToolData] = useAtom(currentToolDataAtom);
  const [currentToolRowSelection, setCurrentToolRowSelection] = useAtom(
    currentToolRowSelectionAtom,
  );
  const t = useT();

  useListenEffect('rename-ext-result', (result: RenameExtResult) => {
    loading.off();
    open.off();
    const { successPaths, errors } = result;
    setLogs(
      [`Successfully renamed ${successPaths.length} files`, ...errors].join(
        '\n',
      ),
    );
    const set = new Set(successPaths);
    const newData = currentToolData
      .map((v) => {
        if (Array.isArray(v)) {
          return v.filter((item) => !set.has(item.path));
        }
        return v;
      })
      .filter((v) => {
        if (Array.isArray(v)) {
          return v.length > 0;
        }
        return !set.has(v.path);
      });
    setCurrentToolData(newData);
    setCurrentToolRowSelection({});
  });

  const paths = getRowSelectionKeys(currentToolRowSelection);

  const handleOpenChange = (v: boolean) => {
    if (loading.value) {
      return;
    }
    open.set(v);
  };

  const handleOk = () => {
    if (loading.value) {
      return;
    }
    loading.on();
    ipc.renameExt({
      items: (currentToolData as any[])
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .map((v) => {
          return { path: v.path, ext: v.properExtension };
        }),
    });
  };

  return (
    <>
      <OperationButton disabled={disabled || !paths.length} onClick={open.on}>
        <TextCursorInput />
        {t('Rename')}
      </OperationButton>
      <OneAlertDialog
        open={open.value}
        onOpenChange={handleOpenChange}
        title={t('Renaming files')}
        okLoading={loading.value}
        description={
          <span>
            <Trans i18nKey="Rename confirm" values={{ length: paths.length }}>
              This will rename extensions of selected
              <span className="text-primary p-1" /> files to more proper. Are
              you want to continue?
            </Trans>
          </span>
        }
        onOk={handleOk}
      />
    </>
  );
}
