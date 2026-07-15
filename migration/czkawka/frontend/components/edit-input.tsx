import { useEffect, useRef, useState } from 'react';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';
import { Input } from './shadcn/input';
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from './shadcn/tooltip';

interface EditInputProps
  extends Pick<
    React.ComponentProps<'input'>,
    'className' | 'placeholder' | 'name' | 'maxLength'
  > {
  initValue?: string;
  onOk: (v: string) => void;
  onValidate: (v: string) => string | undefined;
  onCancel: () => void;
  selectAllWhenMounted?: boolean;
  preventAutoBlur?: boolean;
}

export function EditInput(props: EditInputProps) {
  const {
    className,
    initValue,
    onOk,
    onValidate,
    onCancel,
    selectAllWhenMounted,
    preventAutoBlur,
    ...restProps
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initValue || '');
  const [err, setErr] = useState('');
  const autoBlurBugInMacFlag = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (selectAllWhenMounted) {
        inputRef.current.select();
      }
    }
  }, []);

  const handleOk = async () => {
    if (err) {
      return;
    }
    const finalValue = value.trim();
    if (!finalValue || (initValue && finalValue === initValue)) {
      onCancel();
      return;
    }
    const fail = onValidate(finalValue);
    if (fail) {
      setErr(fail);
      return;
    }
    onOk(finalValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (err) {
      setErr('');
    }
    setValue(e.target.value);
  };

  const handleBlur = () => {
    if (preventAutoBlur && !autoBlurBugInMacFlag.current) {
      autoBlurBugInMacFlag.current = true;
      inputRef.current?.focus();
      return;
    }
    handleOk();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleOk();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <Tooltip open={!!err}>
      <TooltipTrigger asChild>
        <Input
          ref={inputRef}
          className={cn(
            'dark:bg-muted/20 placeholder:italic data-[state=instant-open]:border-destructive data-[state=instant-open]:focus-visible:ring-destructive',
            className,
          )}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          {...restProps}
        />
      </TooltipTrigger>
      <TooltipContent className="bg-destructive text-destructive-foreground">
        <TooltipArrow className="fill-destructive" />
        {err}
      </TooltipContent>
    </Tooltip>
  );
}
