import { ArrowLeft, CalendarClock, ClipboardList, Dumbbell, FileText, MoreHorizontal, Pencil, Sparkles, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { useDeleteSubject, useExercises, useSubject } from '@/api/hooks'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Badge, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, EmptyState, ProgressBar, Spinner } from '@/components/ui/misc'
import { DocumentsSection } from '@/features/documents/DocumentsSection'
import { ExerciseDialog } from '@/features/exercises/ExerciseDialog'
import { ExerciseRow } from '@/features/exercises/ExerciseRow'
import { GenerationPromptDialog } from '@/features/plans/GenerationPromptDialog'
import { ImportDialog } from '@/features/plans/ImportDialog'
import { SubjectDialog } from '@/features/subjects/SubjectDialog'
import { SubjectIcon } from '@/features/subjects/SubjectIcon'
import { t } from '@/i18n'
import { daysUntil, formatDate, formatMinutes } from '@/lib/utils'

export function SubjectPage() {
  const subjectId = Number(useParams().subjectId)
  const { data: subject, isLoading } = useSubject(subjectId)
  const { data: exercises } = useExercises({ subject_id: subjectId })
  const del = useDeleteSubject()
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [exerciseId, setExerciseId] = useState<number | null>(searchParams.get('exercise') ? Number(searchParams.get('exercise')) : null)

  if (isLoading || !subject) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-muted">
        {isLoading ? <Spinner className="h-5 w-5" /> : t('errors.notFound')}
      </div>
    )
  }

  const onDelete = () => {
    if (confirm(`${t('common.confirmDelete', { name: subject.name })}\n${t('subject.deleteWarning')}`)) {
      del.mutate(subject.id, { onSuccess: () => navigate('/subjects') })
    }
  }

  return (
    <>
      <PageHeader
        back={
          <Button variant="ghost" size="icon-sm" asChild className="-ml-2 md:hidden">
            <Link to="/subjects" aria-label={t('common.back')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        }
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ background: subject.color }}>
              <SubjectIcon name={subject.icon} className="h-4 w-4" />
            </span>
            {subject.name}
          </span>
        }
        subtitle={subject.description || undefined}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPromptOpen(true)}>
              <Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">{t('import.generationPrompt')}</span>
            </Button>
            <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> <span className="hidden sm:inline">{t('dashboard.importPlan')}</span>
            </Button>
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.more')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem onSelect={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" /> {t('common.edit')}
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem danger onSelect={onDelete}>
                  <Trash2 className="h-4 w-4" /> {t('common.delete')}
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          </>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-6 md:px-6">
        <section>
          <h2 className="mb-2.5 text-sm font-semibold tracking-tight">{t('subject.plans')}</h2>
          {subject.plans.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title={t('subject.noPlans')}
              hint={t('subject.noPlansHint')}
              action={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setPromptOpen(true)}>
                    <Sparkles className="h-4 w-4" /> {t('import.generationPrompt')}
                  </Button>
                  <Button variant="primary" onClick={() => setImportOpen(true)}>
                    <Upload className="h-4 w-4" /> {t('dashboard.importPlan')}
                  </Button>
                </div>
              }
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {subject.plans.map((p) => {
                const days = p.exam_date ? daysUntil(p.exam_date) : null
                return (
                  <li key={p.id}>
                    <Link to={`/plans/${p.id}`} className="block rounded-xl border bg-bg-elevated p-4 shadow-card transition-colors hover:border-line-strong">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.title}</p>
                          <p className="mt-0.5 text-xs text-fg-muted">
                            {t('subject.nodes', { n: p.progress.nodes_total })} · {t('plan.readyCount', { n: p.progress.ready_count })} ·{' '}
                            {t('plan.remaining', { time: formatMinutes(p.progress.minutes_total - p.progress.minutes_done) })}
                          </p>
                        </div>
                        {p.exam_date && days !== null && (
                          <Badge color={days <= 7 && days >= 0 ? '#ef4444' : subject.color}>
                            <CalendarClock className="h-3 w-3" />
                            {days >= 0 ? t('dashboard.daysLeft', { n: days }) : formatDate(p.exam_date)}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <ProgressBar value={p.progress.percent} color={subject.color} className="flex-1" />
                        <span className="text-xs font-medium tabular-nums">{Math.round(p.progress.percent)}%</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <DocumentsSection subjectId={subject.id} plans={subject.plans} />

        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              {t('subject.exercises')}
              {exercises && exercises.length > 0 && <span className="rounded-full bg-bg-sunken px-1.5 py-0.5 text-[11px] text-fg-muted tabular-nums">{exercises.length}</span>}
            </h2>
            {exercises && exercises.length > 0 && (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/practice?subject=${subject.id}`}>
                  <Dumbbell className="h-4 w-4" /> {t('practice.title')}
                </Link>
              </Button>
            )}
          </div>
          {exercises && exercises.length > 0 ? (
            <ul className="divide-y rounded-xl border bg-bg-elevated shadow-card">
              {exercises.map((e) => (
                <ExerciseRow key={e.id} exercise={e} onOpen={() => setExerciseId(e.id)} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-sm text-fg-muted">
              <ClipboardList className="h-4 w-4" /> {t('node.noExercises')}
            </p>
          )}
        </section>
      </main>

      <SubjectDialog open={editOpen} onOpenChange={setEditOpen} subject={subject} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} subjectId={subject.id} />
      <GenerationPromptDialog open={promptOpen} onOpenChange={setPromptOpen} defaultTopic={subject.name} />
      <ExerciseDialog
        exerciseId={exerciseId}
        onClose={() => {
          setExerciseId(null)
          if (searchParams.has('exercise')) setSearchParams({}, { replace: true })
        }}
      />
    </>
  )
}
