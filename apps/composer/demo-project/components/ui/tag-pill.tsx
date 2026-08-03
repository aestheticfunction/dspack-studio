import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const tagPillVariants = cva('acme-tag-pill inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    hue: {
      gray: 'bg-[var(--acme-wash)] text-[var(--acme-ink)]',
      green: 'bg-[var(--acme-ok-wash)] text-[var(--acme-ok)]',
      red: 'bg-[var(--acme-danger-wash)] text-[var(--acme-danger)]',
      amber: 'bg-[var(--acme-warn-wash)] text-[var(--acme-warn)]',
    },
  },
  defaultVariants: {
    hue: 'gray',
  },
});

export interface TagPillProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof tagPillVariants> {
  /** Short status text; keep under three words. */
  label: string;
}

/** Status marker. Hue is semantic, not decorative. */
const TagPill = React.forwardRef<HTMLSpanElement, TagPillProps>(({ className, hue, label, ...props }, ref) => (
  <span ref={ref} className={cn(tagPillVariants({ hue, className }))} {...props}>
    {label}
  </span>
));
TagPill.displayName = 'TagPill';

export { TagPill, tagPillVariants };
