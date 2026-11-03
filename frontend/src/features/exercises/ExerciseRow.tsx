import { ChevronRight } from 'lucide-react'

import type { AttemptResult, ExerciseListItem } from '@/api/types'
import { Badge } from '@/components/ui/misc'
import { t } from '@/i18n'
import { difficultyDots } from '@/lib/utils'

export const RESULT_COLOR: Record<AttemptResult, string> = { solved: '#10b981', partial: '#f59e0b', failed: '#ef4444' }

export function ExerciseRow({ exercise, onOpen }: { exercise: ExerciseListItem; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-bg-sunken/60">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: exercise.last_result ? RESULT_COLOR[exercise.last_result] : 'var(--line-strong)' }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {exercise.number && <span className="mr-1.5 font-mono text-xs text-fg-subtle">{exercise.number}</span>}
            {exercise.title}
          </span>
          <span className="block truncate text-[11px] text-fg-muted">
            {exercise.source_label}
            {exercise.node_keys.length > 0 && ` · ${exercise.node_keys.join(', ')}`}
          </span>
        </span>
        {exercise.difficulty && <span className="hidden text-[10px] tracking-tighter text-fg-subtle sm:inline">{difficultyDots(exercise.difficulty)}</span>}
        {exercise.attempt_count > 0 && <Badge>{exercise.attempt_count} {t('exercise.attempts').toLowerCase()}</Badge>}
        <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
      </button>
    </li>
  )
}
