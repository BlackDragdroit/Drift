import { Command } from 'cmdk'
import { BookOpen, ClipboardList, FileText, Home, Keyboard, Library, Moon, NotebookPen, Plus, Search, Sparkles, Sun, Upload, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { useSubjects } from '@/api/hooks'
import { searchAll, type SearchHit } from '@/api/learning'
import { t } from '@/i18n'
import { useIsDark, setTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

import { Dialog, DialogContent } from './ui/dialog'
import { Kbd } from './ui/misc'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImport: () => void
  onShortcuts: () => void
}

const KIND_ICON: Record<SearchHit['kind'], React.ComponentType<{ className?: string }>> = {
  subject: Library,
  plan: Waypoints,
  node: BookOpen,
  note: NotebookPen,
  exercise: ClipboardList,
}

export function CommandPalette({ open, onOpenChange, onImport, onShortcuts }: Props) {
  const navigate = useNavigate()
  const { data: subjects } = useSubjects()
  const isDark = useIsDark()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
    }
  }, [open])

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      searchAll(query, 15).then(setHits).catch(() => setHits([])).finally(() => setSearching(false))
    }, 180)
    return () => clearTimeout(handle)
  }, [query, open])

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }
  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  const itemClass = 'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-bg-sunken'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('common.search')} hideTitle className="max-w-xl p-0 [&>div:last-child]:px-0 [&>div:last-child]:pb-0 [&>button[aria-label=Close]]:hidden">
        <Command shouldFilter={query.trim().length < 2} label={t('common.search')} className="flex max-h-[70dvh] flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
            <Command.Input value={query} onValueChange={setQuery} placeholder={t('palette.placeholder')} className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-fg-subtle" />
            {searching && <span className="text-[11px] text-fg-subtle">…</span>}
          </div>
          <Command.List className="scrollbar-thin flex-1 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">{t('palette.noResults')}</Command.Empty>

            {hits.length > 0 && (
              <Command.Group heading={t('palette.results')} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase">
                {hits.map((h) => {
                  const Icon = KIND_ICON[h.kind]
                  return (
                    <Command.Item key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}-${h.title}`} onSelect={() => go(h.url)} className={itemClass}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in oklab, ${h.subject_color} 14%, transparent)`, color: h.subject_color }}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{h.title}</span>
                        <span className="block truncate text-xs text-fg-muted [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-fg" dangerouslySetInnerHTML={{ __html: highlight(h.snippet) }} />
                      </span>
                      <span className="shrink-0 text-[10px] text-fg-subtle">
                        {t(`palette.kinds.${h.kind}`)} · {h.subject_name}
                      </span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}

            {query.trim().length < 2 && (
              <>
                <Command.Group heading={t('palette.actions')} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase">
                  <Command.Item value="import plan" onSelect={() => run(onImport)} className={itemClass}>
                    <Upload className="h-4 w-4 text-fg-muted" /> {t('palette.importPlan')}
                  </Command.Item>
                  <Command.Item value="practice exam mix" onSelect={() => go('/practice?mode=exam')} className={itemClass}>
                    <Sparkles className="h-4 w-4 text-fg-muted" /> {t('palette.practice')}
                  </Command.Item>
                  <Command.Item value="new subject" onSelect={() => go('/subjects?new=1')} className={itemClass}>
                    <Plus className="h-4 w-4 text-fg-muted" /> {t('palette.newSubject')}
                  </Command.Item>
                  <Command.Item value="toggle theme dark light" onSelect={() => run(() => setTheme(isDark ? 'light' : 'dark'))} className={itemClass}>
                    {isDark ? <Sun className="h-4 w-4 text-fg-muted" /> : <Moon className="h-4 w-4 text-fg-muted" />} {t('palette.toggleTheme')}
                  </Command.Item>
                  <Command.Item value="keyboard shortcuts help" onSelect={() => run(onShortcuts)} className={itemClass}>
                    <Keyboard className="h-4 w-4 text-fg-muted" /> {t('palette.shortcuts')} <span className="ml-auto"><Kbd>?</Kbd></span>
                  </Command.Item>
                </Command.Group>
                <Command.Group heading={t('palette.navigate')} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase">
                  <Command.Item value="home dashboard today" onSelect={() => go('/')} className={itemClass}>
                    <Home className="h-4 w-4 text-fg-muted" /> {t('palette.home')} <span className="ml-auto flex gap-1"><Kbd>g</Kbd><Kbd>h</Kbd></span>
                  </Command.Item>
                  <Command.Item value="subjects" onSelect={() => go('/subjects')} className={itemClass}>
                    <Library className="h-4 w-4 text-fg-muted" /> {t('palette.subjects')} <span className="ml-auto flex gap-1"><Kbd>g</Kbd><Kbd>s</Kbd></span>
                  </Command.Item>
                  {subjects?.map((s) => (
                    <div key={s.id}>
                      <Command.Item value={`subject ${s.name}`} onSelect={() => go(`/subjects/${s.id}`)} className={itemClass}>
                        <span className="h-4 w-4 rounded-md" style={{ background: s.color }} /> {s.name}
                      </Command.Item>
                      {s.plans.map((p) => (
                        <Command.Item key={p.id} value={`plan ${s.name} ${p.title}`} onSelect={() => go(`/plans/${p.id}`)} className={cn(itemClass, 'pl-9')}>
                          <FileText className="h-4 w-4 text-fg-muted" /> {p.title}
                        </Command.Item>
                      ))}
                    </div>
                  ))}
                </Command.Group>
              </>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function highlight(snippet: string) {
  const esc = snippet.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\[([^\]]+)\]/g, '<mark>$1</mark>')
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const rows: [string, string[]][] = [
    [t('shortcuts.palette'), ['Ctrl', 'K']],
    [t('shortcuts.goHome'), ['g', 'h']],
    [t('shortcuts.goSubjects'), ['g', 's']],
    [t('shortcuts.map'), ['m']],
    [t('shortcuts.outline'), ['o']],
    [t('shortcuts.scheduleView'), ['s']],
    [t('shortcuts.formulasView'), ['f']],
    [t('shortcuts.closePanel'), ['Esc']],
    [t('shortcuts.practiceKeys'), ['h', 's', '1-3', 'n']],
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('shortcuts.title')}>
        <ul className="divide-y">
          {rows.map(([label, keys]) => (
            <li key={label} className="flex items-center justify-between py-2 text-sm">
              <span>{label}</span>
              <span className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
