import * as React from 'react';

import { cn } from '@/lib/utils';

export interface NoteFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible field label rendered above the textarea. */
  label: string;
  /** Allow the user to drag-resize vertically. */
  resizable?: boolean;
}

/** Multi-line text entry with a mandatory visible label. */
const NoteField = React.forwardRef<HTMLTextAreaElement, NoteFieldProps>(
  ({ className, label, resizable = false, id, ...props }, ref) => {
    const fieldId = id ?? React.useId();
    return (
      <div className="acme-note-field flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-sm font-medium text-[var(--acme-ink)]">
          {label}
        </label>
        <textarea
          id={fieldId}
          ref={ref}
          className={cn(
            'rounded border border-[var(--acme-line)] bg-[var(--acme-surface)] px-3 py-2 text-sm',
            resizable ? 'resize-y' : 'resize-none',
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);
NoteField.displayName = 'NoteField';

export { NoteField };
