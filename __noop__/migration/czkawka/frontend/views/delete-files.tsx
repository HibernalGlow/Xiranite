import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Trash2 } from 'lucide-react';
import { Trans } from 'react-i18next';
import { currentToolAtom, logsAtom } from '@/nodes/czkawka/upstream/atom/primitive';
import { settingsAtom } from '@/nodes/czkawka/upstream/atom/settings';
import { currentToolDataAtom, currentToolRowSelectionAtom } from '@/nodes/czkawka/upstream/atom/tools';
import { OperationButton } from '@/nodes/czkawka/upstream/components';
import { OneAlertDialog } from '@/nodes/czkawka/upstream/components/one-alert-dialog';
import { Tools } from '@/nodes/czkawka/upstream/consts';
import { useBoolean, useListenEffect, useT } from '@/nodes/czkawka/upstream/hooks';
import { ipc } from '@/nodes/czkawka/upstream/ipc';
import { getRowSelectionKeys } from '@/nodes/czkawka/upstream/utils/common';

interface DeleteFilesProps {
  disabled: boolean;
}

interface DeleteFilesResult {
  successPaths: string[];
  errors: string[];
}

export function DeleteFiles(props: DeleteFilesProps) {
  const { disabled } = props;

  const open = useBoolean();
  const loading = useBoolean();
  const setLogs = useSetAtom(logsAtom);
  const settings = useAtomValue(settingsAtom);
  const currentTool = useAtomValue(currentToolAtom);
  const [currentToolData, setCurrentToolData] = useAtom(currentToolDataAtom);
  const [currentToolRowSelection, setCurrentToolRowSelection] = useAtom(
    currentToolRowSelectionAtom,
  );
  const t = useT();

  useListenEffect('delete-files-result', (result: DeleteFilesResult) => {
    loading.off();
    open.off();
    const { successPaths, errors } = result;
    setLogs(
      [`Successfully deleted ${successPaths.length} files`, ...errors].join(
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
    ipc.deleteFiles({
      paths,
      moveDeletedFilesToTrash: settings.moveDeletedFilesToTrash,
      isEmptyFoldersTool: currentTool === Tools.EmptyFolders,
    });
  };

  return (
    <>
      <OperationButton disabled={disabled || !paths.length} onClick={open.on}>
        <Trash2 />
        {t('Delete')}
      </OperationButton>
      <OneAlertDialog
        open={open.value}
        onOpenChange={handleOpenChange}
        title={t('Delete items')}
        okLoading={loading.value}
        description={
          <span>
            <Trans i18nKey="Delete comfirm" values={{ length: paths.length }}>
              Are you sure you want to delete the selected
              <span className="text-primary p-1" /> items?
            </Trans>
          </span>
        }
        onOk={handleOk}
      />
    </>
  );
}
