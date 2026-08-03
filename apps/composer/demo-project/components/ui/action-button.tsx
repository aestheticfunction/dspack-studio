import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const actionButtonVariants = cva(
  'acme-action-button inline-flex items-center justify-center rounded font-medium transition-colors disabled:opacity-50',
  {
    variants: {
      tone: {
        brand: 'bg-[var(--acme-brand)] text-white hover:opacity-90',
        danger: 'bg-[var(--acme-danger)] text-white hover:opacity-90',
        quiet: 'bg-transparent text-[var(--acme-ink)] hover:bg-[var(--acme-wash)]',
        outline: 'border border-[var(--acme-line)] bg-transparent hover:bg-[var(--acme-wash)]',
        plain: 'bg-transparent underline-offset-4 hover:underline',
      },
      density: {
        compact: 'h-7 px-2 text-xs',
        cozy: 'h-9 px-4 text-sm',
        comfortable: 'h-11 px-6 text-base',
      },
    },
    defaultVariants: {
      tone: 'brand',
      density: 'cozy',
    },
  },
);

export interface ActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof actionButtonVariants> {
  /** Visible label. ActionButton never renders bare icons without one. */
  label: string;
}

/** The one button. Tone carries intent; density carries rhythm. */
const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ className, tone, density, label, ...props }, ref) => (
    <button className={cn(actionButtonVariants({ tone, density, className }))} ref={ref} {...props}>
      {label}
    </button>
  ),
);
ActionButton.displayName = 'ActionButton';

export { ActionButton, actionButtonVariants };
