import * as React from 'react';

import { cn } from '@/lib/utils';

/** Structured content container. Compose with InfoCardHeader, InfoCardBody, InfoCardFooter. */
const InfoCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('acme-info-card rounded-lg border border-[var(--acme-line)] bg-[var(--acme-surface)]', className)}
      {...props}
    />
  ),
);
InfoCard.displayName = 'InfoCard';

/** Title strip. Exactly one per InfoCard. */
const InfoCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('acme-info-card-header border-b border-[var(--acme-line)] px-4 py-3', className)} {...props} />
  ),
);
InfoCardHeader.displayName = 'InfoCardHeader';

/** Main content region. */
const InfoCardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('acme-info-card-body px-4 py-4', className)} {...props} />
  ),
);
InfoCardBody.displayName = 'InfoCardBody';

/** Action strip. Optional; holds ActionButtons. */
const InfoCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('acme-info-card-footer flex justify-end gap-2 border-t border-[var(--acme-line)] px-4 py-3', className)} {...props} />
  ),
);
InfoCardFooter.displayName = 'InfoCardFooter';

export { InfoCard, InfoCardHeader, InfoCardBody, InfoCardFooter };
