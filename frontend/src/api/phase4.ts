import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from './client'
import { keys } from './hooks'
import type { components } from './schema'
import type { Exercise } from './types'

type S = components['schemas']
export type FlashcardDetail = S['FlashcardDetailOut']
export type DueQueue = S['DueQueueOut']
export type BackupInfo = S['BackupInfoOut']
export type RestoreResult = S['RestoreOut']

export const cardKeys = {
  due: (p: { subject_id?: number; plan_id?: number; node_id?: number }) => ['flashcards', 'due', p] as const,
  node: (nodeId: number) => ['flashcards', 'node', nodeId] as const,
}

export function useDueCards(params: { subject_id?: number; plan_id?: number; node_id?: number }, enabled = true) {
  return useQuery({
    queryKey: cardKeys.due(params),
    queryFn: async () => unwrap(await api.GET('/api/flashcards/due', { params: { query: { ...params, limit: 50 } } })) as DueQueue,
    enabled,
    staleTime: 0,
  })
}

export function useNodeCards(nodeId: number | null) {
  return useQuery({
    queryKey: cardKeys.node(nodeId ?? -1),
    queryFn: async () => unwrap(await api.GET('/api/flashcards', { params: { query: { node_id: nodeId as number } } })) as FlashcardDetail[],
    enabled: nodeId !== null,
  })
}

function invalidateCards(qc: ReturnType<typeof useQueryClient>, nodeId?: number | null) {
  qc.invalidateQueries({ queryKey: ['flashcards'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
  if (nodeId) qc.invalidateQueries({ queryKey: keys.node(nodeId) })
}

export function useReviewCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, rating, duration_ms }: { id: number; rating: number; duration_ms?: number }) =>
      unwrap(await api.POST('/api/flashcards/{card_id}/review', { params: { path: { card_id: id } }, body: { rating, duration_ms } })) as FlashcardDetail,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })
}

export function useCreateCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { node_id: number; front: string; back: string }) => unwrap(await api.POST('/api/flashcards', { body })) as FlashcardDetail,
    onSuccess: (c) => invalidateCards(qc, c.node_id),
  })
}

export function useUpdateCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; front?: string; back?: string }) =>
      unwrap(await api.PATCH('/api/flashcards/{card_id}', { params: { path: { card_id: id } }, body })) as FlashcardDetail,
    onSuccess: (c) => invalidateCards(qc, c.node_id),
  })
}

export function useDeleteCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: number; nodeId: number }) => {
      unwrap(await api.DELETE('/api/flashcards/{card_id}', { params: { path: { card_id: id } } }))
    },
    onSuccess: (_r, { nodeId }) => invalidateCards(qc, nodeId),
  })
}

export function useGenerateCards() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nodeId, count }: { nodeId: number; count: number }) =>
      unwrap(await api.POST('/api/flashcards/generate/{node_id}', { params: { path: { node_id: nodeId } }, body: { count } })),
    onSuccess: (_r, { nodeId }) => invalidateCards(qc, nodeId),
  })
}

export function useSimilarExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (exerciseId: number) =>
      unwrap(await api.POST('/api/system/exercises/{exercise_id}/similar', { params: { path: { exercise_id: exerciseId } } })) as Exercise,
    onSuccess: (ex) => {
      qc.setQueryData(keys.exercise(ex.id), ex)
      qc.invalidateQueries({ queryKey: ['exercises'] })
      qc.invalidateQueries({ queryKey: ['nodes'] })
      qc.invalidateQueries({ queryKey: keys.subjects })
    },
  })
}

export function useSystemStats() {
  return useQuery({
    queryKey: ['system', 'stats'],
    queryFn: async () => unwrap(await api.GET('/api/system/stats')) as BackupInfo,
  })
}

export async function restoreBackup(file: File): Promise<RestoreResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/system/restore', { method: 'POST', body: form, headers: { 'X-Requested-With': 'fetch' } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : `Restore failed (${res.status})`)
  }
  return (await res.json()) as RestoreResult
}

export async function reindexSearch(): Promise<number> {
  const r = unwrap(await api.POST('/api/system/reindex')) as { indexed: number }
  return r.indexed
}
