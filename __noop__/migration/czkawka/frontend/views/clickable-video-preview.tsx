import { invoke } from '@/nodes/czkawka/upstream/adapters/tauri-core';

interface ClickableVideoPreviewProps {
  path: string;
  children: React.ReactNode;
  className?: string;
  disableDefaultStyles?: boolean;
}

export function ClickableVideoPreview(props: ClickableVideoPreviewProps) {
  const { children, path, className, disableDefaultStyles = false } = props;
  const handleClick = () => {
    invoke('open_system_path', { path }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('Failed to open video', path, e);
    });
  };

  const defaultClassName = disableDefaultStyles
    ? 'cursor-pointer'
    : 'cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5 transition-colors';

  return (
    <button
      type="button"
      className={className || defaultClassName}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {children}
    </button>
  );
}
