import * as React from 'react';

import { cn } from '@/lib/utils';

export interface MiniStepperProps extends React.HTMLAttributes<HTMLOListElement> {
  /** Ordered steps; each entry is free-form step data. */
  steps: Array<{ label: string; done?: boolean }>;
}

/** Compact progress indicator. Steps are data, not children. */
const MiniStepper = React.forwardRef<HTMLOListElement, MiniStepperProps>(({ className, steps, ...props }, ref) => (
  <ol ref={ref} className={cn('acme-mini-stepper flex items-center gap-2', className)} {...props}>
    {steps.map((step, i) => (
      <li key={i} className={cn('flex items-center gap-1 text-xs', step.done ? 'text-[var(--acme-ok)]' : 'text-[var(--acme-ink-dim)]')}>
        <span className="acme-mini-stepper-dot h-2 w-2 rounded-full bg-current" />
        {step.label}
      </li>
    ))}
  </ol>
));
MiniStepper.displayName = 'MiniStepper';

export { MiniStepper };
