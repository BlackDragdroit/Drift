import { Check } from 'lucide-react'
import { Checkbox as RadixCheckbox, DropdownMenu as RadixDropdown, Tooltip as RadixTooltip } from 'radix-ui'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

// ----------------------------------------------------------------------------- tooltip

export const TooltipProvider = RadixTooltip.Provider

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md bg-fg px-2.5 py-1.5 text-xs text-bg shadow-pop data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

// ----------------------------------------------------------------------------- dropdown

export const Dropdown = RadixDropdown.Root
export const DropdownTrigger = RadixDropdown.Trigger

export function DropdownContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-[180px] rounded-lg border bg-bg-elevated p-1 shadow-pop data-[state=open]:animate-rise', className)}
      >
        {children}
      </RadixDropdown.Content>
    </RadixDropdown.Portal>
  )
}

export function DropdownItem({ className, danger, ...props }: RadixDropdown.DropdownMenuItemProps & { danger?: boolean }) {
  return (
    <RadixDropdown.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-bg-sunken data-[disabled]:opacity-50',
        danger && 'text-red-600 dark:text-red-400',
        className,
      )}
      {...props}
    />
  )
}

export const DropdownSeparator = () => <RadixDropdown.Separator className="my-1 h-px bg-line" />
export const DropdownLabel = ({ children }: { children: ReactNode }) => (
  <RadixDropdown.Label className="px-2.5 py-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{children}</RadixDropdown.Label>
)

// ----------------------------------------------------------------------------- checkbox

export function Checkbox({ checked, onCheckedChange, label, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: ReactNode; id?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
      <RadixCheckbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-line-strong bg-bg-elevated data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg"
      >
        <RadixCheckbox.Indicator>
          <Check className="h-3 w-3" strokeWidth={3} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <span className="leading-snug">{label}</span>
    </label>
  )
}

// ----------------------------------------------------------------------------- bits

export function Badge({ className, color, children, ...props }: HTMLAttributes<HTMLSpanElement> & { color?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', className)}
      style={color ? { borderColor: `color-mix(in oklab, ${color} 40%, transparent)`, color, background: `color-mix(in oklab, ${color} 10%, transparent)` } : undefined}
      {...props}
    >
      {children}
    </span>
  )
}

export function ProgressBar({ value, color, className, height = 'h-1.5' }: { value: number; color?: string; className?: string; height?: string }) {
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-line', height, className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color ?? 'var(--accent)' }} />
    </div>
  )
}

export function ProgressRing({ value, size = 36, stroke = 3.5, color, children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'var(--accent)'} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value / 100)))}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums">{children}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
      {icon && <div className="mb-3 text-fg-subtle">{icon}</div>}
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-fg-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">{children}</kbd>
}
