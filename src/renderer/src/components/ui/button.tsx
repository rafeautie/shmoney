import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// The background and border live on a ::before shell so a press can shrink
// the shell alone; the label, icons and focus ring stay put.
const buttonVariants = cva(
  "group/button relative isolate inline-flex shrink-0 items-center justify-center rounded-[6px] border border-transparent text-xs/relaxed font-medium whitespace-nowrap transition-[color,box-shadow,opacity] outline-none select-none before:absolute before:-inset-px before:-z-10 before:rounded-[inherit] before:border before:border-transparent before:transition-[background-color,border-color,box-shadow,scale] before:duration-[120ms,120ms,120ms,100ms] focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:before:border-ring active:not-aria-[haspopup]:before:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive/20 aria-invalid:before:border-destructive dark:aria-invalid:ring-destructive/40 dark:aria-invalid:before:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'text-primary-foreground before:bg-primary hover:before:bg-primary/80',
        outline:
          'before:border-border hover:text-foreground hover:before:bg-muted aria-expanded:text-foreground aria-expanded:before:bg-muted',
        // an input-styled trigger (pickers, date ranges) that sits beside real fields
        field:
          'font-normal before:border-input before:bg-input/20 hover:text-foreground hover:before:bg-muted aria-expanded:text-foreground aria-expanded:before:bg-muted',
        secondary:
          'text-secondary-foreground before:bg-secondary hover:before:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:text-secondary-foreground aria-expanded:before:bg-secondary',
        ghost:
          'hover:text-foreground hover:before:bg-muted aria-expanded:text-foreground aria-expanded:before:bg-muted dark:hover:before:bg-muted/50',
        // an editable table value: hover tints, and the cell whose editor is
        // open lifts so it reads as attached to its popover
        cell: 'font-normal not-aria-expanded:hover:text-foreground not-aria-expanded:hover:before:bg-muted aria-expanded:text-foreground aria-expanded:before:lifted dark:not-aria-expanded:hover:before:bg-muted/50',
        destructive:
          'text-destructive before:bg-destructive/10 hover:before:bg-destructive/20 focus-visible:ring-destructive/20 focus-visible:before:border-destructive/40 dark:before:bg-destructive/20 dark:hover:before:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default:
          "h-7 gap-1 px-2.5 text-[12.5px]/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        'icon-xs': "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        'icon-sm': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-lg': "size-8 [&_svg:not([class*='size-'])]:size-4"
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
