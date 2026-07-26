import { Text } from "lucide-react";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  ReaderFolderTitleWrapConfig,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client";
import { FOLDER_VIEW_PRESENTATION_OPTIONS } from "./FolderViewPresentation";

export default function FolderViewTitleWrapMenu({
  value,
  onChange,
}: {
  value: ReaderFolderTitleWrapConfig;
  onChange(viewMode: ReaderFolderViewMode, wrapTitle: boolean): void;
}) {
  const enabledCount = FOLDER_VIEW_PRESENTATION_OPTIONS.filter(
    ({ value: viewMode }) => value[viewMode],
  ).length;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Text className="size-4" />
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span>标题换行</span>
          <span className="truncate text-[10px] font-normal text-muted-foreground">
            {enabledCount} / {FOLDER_VIEW_PRESENTATION_OPTIONS.length}{" "}
            个视图已开启
          </span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-52"
        data-folder-toolbar-menu="title-wrap"
      >
        {FOLDER_VIEW_PRESENTATION_OPTIONS.map(({ value: viewMode, label }) => (
          <DropdownMenuCheckboxItem
            key={viewMode}
            checked={value[viewMode]}
            data-folder-title-wrap-view={viewMode}
            onCheckedChange={(checked) => onChange(viewMode, checked === true)}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
