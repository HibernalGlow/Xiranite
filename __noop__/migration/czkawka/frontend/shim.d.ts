import '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // Align with v8 generics to avoid declaration conflicts
  interface ColumnMeta<TData extends RowData, TValue> {
    span: number;
  }
}
