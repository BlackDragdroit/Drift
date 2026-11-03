import { X } from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close

interface ContentProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
  /** 'sheet' renders a right-side panel on desktop and a bottom sheet on mobile. */
  mode?: 'modal' | 'sheet'
  footer?: ReactNode
  hideTitle?: boolean
}

export function DialogContent({ title, description, children, className, mode = 'modal', footer, hideTitle }: ContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <RadixDialog.Content
        className={cn(
          'fixed z-50 flex flex-col bg-bg-elevated text-fg shadow-pop focus:outline-none',
          mode === 'modal' &&
            'top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border data-[state=open]:animate-rise',
          mode === 'sheet' &&
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t data-[state=open]:animate-rise md:inset-y-0 md:right-0 md:left-auto md:h-full md:max-h-none md:w-[440px] md:rounded-none md:border-t-0 md:border-l',
          className,
        )}
      >
        <div className={cn('flex items-start gap-3 px-5 pt-4 pb-3', hideTitle && 'sr-only')}>
          <div className="min-w-0 flex-1">
            <RadixDialog.Title className="text-base leading-tight font-semibold tracking-tight">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-sm text-fg-muted">{description}</RadixDialog.Description>
            ) : (
              <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close className="-mr-1.5 rounded-md p-1.5 text-fg-subtle hover:bg-bg-sunken hover:text-fg" aria-label="Close">
            <X className="h-4 w-4" />
          </RadixDialog.Close>
        </div>
        {hideTitle && (
          <RadixDialog.Close className="absolute top-3 right-3 z-10 rounded-md p-1.5 text-fg-subtle hover:bg-bg-sunken hover:text-fg" aria-label="Close">
            <X className="h-4 w-4" />
          </RadixDialog.Close>
        )}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
