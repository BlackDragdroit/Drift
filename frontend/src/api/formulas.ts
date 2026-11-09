import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from './client'
import type { components } from './schema'

type S = components['schemas']
export type Formula = S['FormulaOut']
export type FormulaCreate = Omit<S['FormulaCreate'], 'title' | 'note' | 'source'> & Partial<Pick<S['FormulaCreate'], 'title' | 'note' | 'source'>>
export type FormulaUpdate = S['FormulaUpdate']
export type FormulaHarvest = S['FormulaHarvestOut']
export type FormulaCandidate = S['FormulaCandidateOut']

export const formulaKeys = {
  plan: (planId: number) => ['formulas', planId] as const,
}

export function usePlanFormulas(planId: number | null) {
  return useQuery({
    queryKey: formulaKeys.plan(planId ?? -1),
    queryFn: async () => unwrap(await api.GET('/api/formulas', { params: { query: { plan_id: planId as number } } })) as Formula[],
    enabled: planId !== null,
  })
}

export function formulaExportUrl(planId: number) {
  return `/api/formulas/export.md?plan_id=${planId}`
}

function invalidate(qc: ReturnType<typeof useQueryClient>, planId: number) {
  qc.invalidateQueries({ queryKey: formulaKeys.plan(planId) })
}

export function useCreateFormula() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: FormulaCreate) =>
      unwrap(await api.POST('/api/formulas', { body: { title: '', note: '', source: 'manual', ...body } })) as Formula,
    onSuccess: (f) => invalidate(qc, f.plan_id),
  })
}

export function useUpdateFormula() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: FormulaUpdate & { id: number }) =>
      unwrap(await api.PATCH('/api/formulas/{entry_id}', { params: { path: { entry_id: id } }, body })) as Formula,
    onSuccess: (f) => invalidate(qc, f.plan_id),
  })
}

export function useDeleteFormula() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: number; planId: number }) => {
      unwrap(await api.DELETE('/api/formulas/{entry_id}', { params: { path: { entry_id: id } } }))
    },
    onSuccess: (_r, { planId }) => invalidate(qc, planId),
  })
}

export function useReorderFormulas(planId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: number[]) =>
      unwrap(await api.POST('/api/formulas/reorder', { params: { query: { plan_id: planId } }, body: { ids } })) as Formula[],
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: formulaKeys.plan(planId) })
      const prev = qc.getQueryData<Formula[]>(formulaKeys.plan(planId))
      if (prev) {
        const rank = new Map(ids.map((id, i) => [id, i]))
        qc.setQueryData<Formula[]>(
          formulaKeys.plan(planId),
          [...prev].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)),
        )
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(formulaKeys.plan(planId), ctx.prev),
    onSettled: () => invalidate(qc, planId),
  })
}

export function useHarvestFormulas() {
  return useMutation({
    mutationFn: async (body: { exercise_id?: number; node_id?: number }) =>
      unwrap(await api.POST('/api/formulas/harvest', { body })) as FormulaHarvest,
  })
}
