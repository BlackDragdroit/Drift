import { Database, Download, Keyboard, Monitor, Moon, RefreshCw, Smartphone, Sun, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { reindexSearch, restoreBackup, useSystemStats } from '@/api/phase4'
import { ShortcutsDialog } from '@/components/CommandPalette'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function SettingsPage() {
  const [theme, setTheme] = useTheme()
  const { data: stats, refetch } = useSystemStats()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const onRestore = async (file: File | undefined) => {
    if (!file || !confirm(t('settings.restoreConfirm'))) return
    setBusy('restore')
    setError(null)
    try {
      const r = await restoreBackup(file)
      setMessage(t('settings.restored', { date: r.created_at ? new Date(r.created_at).toLocaleString() : '?', files: r.upload_files }))
      setTimeout(() => window.location.assign('/'), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'))
    } finally {
      setBusy(null)
    }
  }

  const onReindex = async () => {
    setBusy('reindex')
    try {
      setMessage(t('settings.reindexed', { n: await reindexSearch() }))
    } finally {
      setBusy(null)
    }
  }

  const themes: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: t('nav.light'), icon: <Sun className="h-4 w-4" /> },
    { value: 'dark', label: t('nav.dark'), icon: <Moon className="h-4 w-4" /> },
    { value: 'system', label: t('nav.system'), icon: <Monitor className="h-4 w-4" /> },
  ]

  return (
    <>
      <PageHeader title={t('settings.title')} />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-6 md:px-6">
        <Card title={t('settings.appearance')}>
          <div className="inline-flex rounded-lg border bg-bg-sunken p-0.5">
            {themes.map((o) => (
              <button key={o.value} onClick={() => setTheme(o.value)} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', theme === o.value ? 'bg-bg-elevated shadow-sm' : 'text-fg-muted hover:text-fg')}>
                {o.icon} {o.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="ml-3" onClick={() => setShortcutsOpen(true)}>
            <Keyboard className="h-4 w-4" /> {t('settings.shortcuts')}
          </Button>
        </Card>

        <Card title={t('settings.data')}>
          {stats && (
            <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-bg-sunken/60 p-3">
                <dt className="text-[11px] text-fg-muted uppercase">{t('settings.dbSize')}</dt>
                <dd className="font-semibold tabular-nums">{bytes(stats.db_bytes)}</dd>
              </div>
              <div className="rounded-lg bg-bg-sunken/60 p-3">
                <dt className="text-[11px] text-fg-muted uppercase">{t('settings.uploadsSize')}</dt>
                <dd className="font-semibold tabular-nums">{bytes(stats.uploads_bytes)}</dd>
              </div>
            </dl>
          )}
          <div className="space-y-3">
            <Row icon={<Download className="h-4 w-4" />} title={t('settings.backup')} hint={t('settings.backupHint')}>
              <Button variant="primary" size="sm" asChild>
                <a href="/api/system/backup" download>{t('settings.backup')}</a>
              </Button>
            </Row>
            <Row icon={<Upload className="h-4 w-4" />} title={t('settings.restore')} hint={t('settings.restoreHint')}>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy === 'restore'}>
                {busy === 'restore' ? <Spinner /> : <Upload className="h-4 w-4" />} {t('settings.restore')}
              </Button>
              <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => onRestore(e.target.files?.[0])} />
            </Row>
            <Row icon={<Database className="h-4 w-4" />} title={t('settings.reindex')}>
              <Button variant="outline" size="sm" onClick={onReindex} disabled={busy === 'reindex'}>
                {busy === 'reindex' ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t('settings.reindex')}
              </Button>
            </Row>
            {stats && stats.previous_backups.length > 0 && (
              <p className="text-xs text-fg-subtle">Server-side copies: {stats.previous_backups.join(', ')}</p>
            )}
          </div>
          {message && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button className="sr-only" onClick={() => refetch()}>refresh</button>
        </Card>

        <Card title={t('settings.install')}>
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0" /> {t('settings.installHint')}
          </p>
        </Card>
      </main>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-bg-elevated p-5 shadow-card">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Row({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <span className="text-fg-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-fg-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}
