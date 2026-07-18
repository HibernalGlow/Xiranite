import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/nodes/czkawka/upstream/utils/cn';
import { badgeVariants } from './shadcn/badge';

const toggleBadgeVariants = cva(
  'cursor-pointer select-none active:scale-95 transition-all',
  {
    variants: {
      pressed: {
        true: 'scale-105 shadow-md shadow-primary/20',
        false: 'opacity-70 hover:opacity-100',
      },
    },
    defaultVariants: {
      pressed: false,
    },
  },
);

export interface ToggleBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof toggleBadgeVariants> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const ToggleBadge = React.forwardRef<HTMLDivElement, ToggleBadgeProps>(
  ({ className, checked, onCheckedChange, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          badgeVariants({ variant: checked ? 'default' : 'secondary' }),
          toggleBadgeVariants({ pressed: checked }),
          className,
        )}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      >
        {children}
      </div>
    );
  },
);

ToggleBadge.displayName = 'ToggleBadge';

export { ToggleBadge };
