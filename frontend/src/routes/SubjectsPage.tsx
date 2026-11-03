import { Library, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useSubjects } from '@/api/hooks'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { EmptyState, ProgressBar, Spinner } from '@/components/ui/misc'
import { SubjectDialog } from '@/features/subjects/SubjectDialog'
import { SubjectIcon } from '@/features/subjects/SubjectIcon'
import { t } from '@/i18n'

export function SubjectsPage() {
  const { data: subjects, isLoading } = useSubjects()
  const [params] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1')

  return (
    <>
      <PageHeader
        title={t('nav.subjects')}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {t('dashboard.newSubject')}
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        {isLoading && (
          <div className="flex justify-center py-20 text-fg-muted">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {subjects && subjects.length === 0 && (
          <EmptyState
            icon={<Library className="h-8 w-8" />}
            title={t('dashboard.empty')}
            hint={t('dashboard.emptyHint')}
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> {t('dashboard.newSubject')}
              </Button>
            }
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subjects?.map((s, i) => (
            <Link
              key={s.id}
              to={`/subjects/${s.id}`}
              className="group animate-rise rounded-xl border bg-bg-elevated p-4 shadow-card transition-[border-color,transform] hover:border-line-strong"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: s.color }}>
                  <SubjectIcon name={s.icon} className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {s.plans.length} {t('subject.plans').toLowerCase()} · {s.exercise_count} {t('subject.exercises').toLowerCase()}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{Math.round(s.progress?.percent ?? 0)}%</span>
              </div>
              <ProgressBar value={s.progress?.percent ?? 0} color={s.color} className="mt-3" />
            </Link>
          ))}
        </div>
      </main>
      <SubjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
