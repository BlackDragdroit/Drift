import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from './client'
import { keys } from './hooks'
import type { components } from './schema'

type S = components['schemas']
export type Schedule = S['ScheduleOut']
export type ScheduleDay = S['ScheduleDayOut']
export type PracticeRequest = S['PracticeRequest']
export type PracticeQueue = S['PracticeQueueOut']
export type StudySession = S['SessionOut']
export type SearchHit = S['SearchHitOut']
export type Dashboard = S['DashboardOut']
export type DashboardNode = S['DashboardNodeOut']
export type WeakSpot = S['WeakSpotOut']

export const tzOffset = () => -new Date().getTimezoneOffset()

export function useSchedule(planId: number) {
  return useQuery({
    queryKey: ['plans', planId, 'schedule'],
    queryFn: async () => unwrap(await api.GET('/api/plans/{plan_id}/schedule', { params: { path: { plan_id: planId } } })) as Schedule,
  })
}

export function useDashboardV2() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => unwrap(await api.GET('/api/dashboard', { params: { query: { tz_offset: tzOffset() } } })) as Dashboard,
    staleTime: 15_000,
  })
}

export async function fetchPracticeQueue(body: PracticeRequest): Promise<PracticeQueue> {
  return unwrap(await api.POST('/api/practice/queue', { body })) as PracticeQueue
}

export async function searchAll(q: string, limit = 20): Promise<SearchHit[]> {
  if (!q.trim()) return []
  return unwrap(await api.GET('/api/search', { params: { query: { q, limit } } })) as SearchHit[]
}

// ----------------------------------------------------------------------------- study sessions

const sessionKey = ['sessions', 'active'] as const

export function useActiveSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => (unwrap(await api.GET('/api/sessions/active')) as StudySession | null) ?? null,
    staleTime: 30_000,
  })
}

export function useStartSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { node_id?: number | null; subject_id?: number | null }) => unwrap(await api.POST('/api/sessions/start', { body })) as StudySession,
    onSuccess: (s) => {
      qc.setQueryData(sessionKey, s)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useStopSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, note = '' }: { id: number; note?: string }) =>
      unwrap(await api.POST('/api/sessions/{session_id}/stop', { params: { path: { session_id: id } }, body: { note } })) as StudySession,
    onSuccess: (s) => {
      qc.setQueryData(sessionKey, null)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      if (s.node_id) qc.invalidateQueries({ queryKey: keys.node(s.node_id) })
    },
  })
}

export function useNodeSessions(nodeId: number | null) {
  return useQuery({
    queryKey: ['sessions', 'node', nodeId],
    queryFn: async () => unwrap(await api.GET('/api/sessions', { params: { query: { node_id: nodeId as number, limit: 20 } } })) as StudySession[],
    enabled: nodeId !== null,
  })
}
