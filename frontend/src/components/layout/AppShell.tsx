import { Home, Layers, Library, LogOut, Monitor, Moon, Plus, Search, Settings, Sparkles, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'

import { useLogout, useSubjects } from '@/api/hooks'
import { ImportDialog } from '@/features/plans/ImportDialog'
import { t } from '@/i18n'
import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

import { CommandPalette, ShortcutsDialog } from '../CommandPalette'
import { StudyTimerPill } from '../StudyTimer'
import { Button } from '../ui/button'
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, ProgressRing, Tooltip } from '../ui/misc'

export function AppShell() {
  const [importOpen, setImportOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const navigate = useNavigate()

  // Global shortcuts: Ctrl/Cmd+K palette, "?" help, "/" search, "g h" / "g s" / "g p" navigation
  useEffect(() => {
    let pendingG = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (e.key === '?') return setShortcutsOpen(true)
      if (e.key === '/') {
        e.preventDefault()
        return setPaletteOpen(true)
      }
      if (e.key === 'g') {
        pendingG = Date.now()
        return
      }
      if (pendingG && Date.now() - pendingG < 800) {
        pendingG = 0
        if (e.key === 'h') navigate('/')
        if (e.key === 's') navigate('/subjects')
        if (e.key === 'p') navigate('/practice')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="flex min-h-dvh">
      <Sidebar onImport={() => setImportOpen(true)} onSearch={() => setPaletteOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet context={{ openImport: () => setImportOpen(true), openSearch: () => setPaletteOpen(true) }} />
      </div>
      <MobileNav onImport={() => setImportOpen(true)} onSearch={() => setPaletteOpen(true)} />
      <StudyTimerPill />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onImport={() => setImportOpen(true)} onShortcuts={() => setShortcutsOpen(true)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}

function Sidebar({ onImport, onSearch }: { onImport: () => void; onSearch: () => void }) {
  const { data: subjects } = useSubjects()
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-bg-elevated/60 print:hidden md:flex">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
        <span className="font-semibold tracking-tight">{t('app.name')}</span>
      </div>
      <div className="px-2 pb-2">
        <button onClick={onSearch} className="flex w-full items-center gap-2 rounded-md border bg-bg px-2.5 py-1.5 text-left text-sm text-fg-subtle hover:border-line-strong">
          <Search className="h-4 w-4" />
          <span className="flex-1">{t('common.search')}</span>
          <kbd className="rounded border bg-bg-sunken px-1 font-mono text-[10px]">{t('palette.hint')}</kbd>
        </button>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        <SideLink to="/" icon={<Home className="h-4 w-4" />} label={t('nav.home')} end />
        <SideLink to="/subjects" icon={<Library className="h-4 w-4" />} label={t('nav.subjects')} end />
        <SideLink to="/practice" icon={<Sparkles className="h-4 w-4" />} label={t('practice.title')} />
        <SideLink to="/review" icon={<Layers className="h-4 w-4" />} label={t('cards.title')} />
      </nav>
      <div className="mt-4 flex items-center justify-between px-4 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
        <span>{t('nav.subjects')}</span>
        <Tooltip content={t('dashboard.importPlan')}>
          <button onClick={onImport} className="rounded p-0.5 hover:bg-bg-sunken hover:text-fg" aria-label={t('dashboard.importPlan')}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
      <nav className="scrollbar-thin mt-1 flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {subjects?.map((s) => (
          <NavLink
            key={s.id}
            to={`/subjects/${s.id}`}
            className={({ isActive }) =>
              cn('group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg', isActive && 'bg-bg-sunken text-fg')
            }
          >
            <ProgressRing value={s.progress?.percent ?? 0} size={20} stroke={3} color={s.color} />
            <span className="truncate">{s.name}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-2">
        <UserMenu />
      </div>
    </aside>
  )
}

function SideLink({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-sunken hover:text-fg', isActive && 'bg-bg-sunken font-medium text-fg')
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

function MobileNav({ onImport, onSearch }: { onImport: () => void; onSearch: () => void }) {
  const item = 'flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-fg-muted'
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-bg-elevated/90 pb-[env(safe-area-inset-bottom)] backdrop-blur print:hidden md:hidden">
      <NavLink to="/" end className={({ isActive }) => cn(item, isActive && 'text-accent')}>
        <Home className="h-5 w-5" />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/subjects" end className={({ isActive }) => cn(item, isActive && 'text-accent')}>
        <Library className="h-5 w-5" />
        {t('nav.subjects')}
      </NavLink>
      <NavLink to="/practice" className={({ isActive }) => cn(item, isActive && 'text-accent')}>
        <Sparkles className="h-5 w-5" />
        {t('practice.title')}
      </NavLink>
      <button className={item} onClick={onSearch}>
        <Search className="h-5 w-5" />
        {t('common.search')}
      </button>
      <button className={item} onClick={onImport}>
        <Plus className="h-5 w-5" />
        {t('dashboard.importPlan')}
      </button>
      <div className={item}>
        <UserMenu compact />
      </div>
    </nav>
  )
}

export function UserMenu({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme()
  const logout = useLogout()
  const navigate = useNavigate()
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('nav.light'), icon: <Sun className="h-4 w-4" /> },
    { value: 'dark', label: t('nav.dark'), icon: <Moon className="h-4 w-4" /> },
    { value: 'system', label: t('nav.system'), icon: <Monitor className="h-4 w-4" /> },
  ]
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        {compact ? (
          <button className="flex flex-col items-center gap-0.5" aria-label={t('nav.settings')}>
            <ThemeIcon className="h-5 w-5" />
            {t('nav.settings')}
          </button>
        ) : (
          <Button variant="ghost" className="w-full justify-start gap-2.5 px-2">
            <ThemeIcon className="h-4 w-4" />
            {t('nav.settings')}
          </Button>
        )}
      </DropdownTrigger>
      <DropdownContent align={compact ? 'end' : 'start'}>
        {options.map((o) => (
          <DropdownItem key={o.value} onSelect={() => setTheme(o.value)} className={cn(theme === o.value && 'text-accent')}>
            {o.icon}
            {o.label}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => navigate('/settings')}>
          <Settings className="h-4 w-4" />
          {t('settings.title')}
        </DropdownItem>
        <DropdownItem onSelect={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}>
          <LogOut className="h-4 w-4" />
          {t('nav.logout')}
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}

export function PageHeader({ title, subtitle, actions, back, children }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
        {back}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-semibold tracking-tight md:text-xl">{title}</h1>
          {subtitle && <div className="mt-0.5 truncate text-xs text-fg-muted md:text-sm">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
