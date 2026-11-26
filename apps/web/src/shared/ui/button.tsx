import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { usePendingAction } from '@/shared/hooks/use-pending-action';
import { cn } from '@/shared/lib/tailwind';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background cursor-pointer transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-black/60 hover:text-accent-foreground',
        fullGhost:
          'bg-transparent hover:bg-transparent hover:text-accent-foreground hover:scale-102 hover:opacity-100',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Shows a spinner instead of the content and ignores clicks. It is automatic when `onClick`
   * returns a promise: the button waits for it. Use this prop when the wait is not that promise.
   */
  loading?: boolean;
}

/**
 * Content of a button that is waiting for an answer: the spinner takes the place of the content,
 * which stays in the layout (invisible) so the button does not change its size.
 */
function ButtonLoadingContent({ busy, children }: { busy: boolean; children?: React.ReactNode }) {
  if (!busy) return <>{children}</>;

  return (
    <>
      <span className="invisible contents">{children}</span>
      <span className="absolute inset-0 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      </span>
    </>
  );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, onClick, children, ...props }, ref) => {
    const { pending, run } = usePendingAction(onClick, loading);

    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} onClick={onClick} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }), pending && 'relative cursor-wait')}
        ref={ref}
        aria-busy={pending || undefined}
        onClick={run}
        {...props}
      >
        <ButtonLoadingContent busy={pending}>{children}</ButtonLoadingContent>
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, ButtonLoadingContent, buttonVariants };
