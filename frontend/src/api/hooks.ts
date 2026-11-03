import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'

import { api, unwrap } from './client'
import type {
  AttemptCreate,
  Exercise,
  ExerciseListItem,
  ImportPreview,
  ImportPreviewRequest,
  ImportRequest,
  ImportResult,
  NodeDetail,
  NodeUpdate,
  PlanDetail,
  PlanNode,
  PlanSummary,
  PlanUpdate,
  Status,
  Subject,
  SubjectCreate,
  SubjectUpdate,
  User,
} from './types'

export const keys = {
  me: ['me'] as const,
  subjects: ['subjects'] as const,
  subject: (id: number) => ['subjects', id] as const,
  plans: ['plans'] as const,
  plan: (id: number) => ['plans', id] as const,
  node: (id: number) => ['nodes', id] as const,
  exercises: (params: { subject_id?: number; node_id?: number }) => ['exercises', params] as const,
  exercise: (id: number) => ['exercises', id] as const,
}

// ----------------------------------------------------------------------------- auth

export function useMe(options?: Partial<UseQueryOptions<User | null>>) {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      const r = await api.GET('/api/auth/me')
      if (r.response.status === 401) return null
      return unwrap(r)
    },
    staleTime: 5 * 60_000,
    retry: false,
    ...options,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (password: string) => unwrap(await api.POST('/api/auth/login', { body: { password } })),
    onSuccess: (user) => qc.setQueryData(keys.me, user),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.POST('/api/auth/logout')
    },
    onSuccess: () => {
      qc.clear()
      qc.setQueryData(keys.me, null)
    },
  })
}

// ----------------------------------------------------------------------------- dashboard

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => unwrap(await api.GET('/api/dashboard')),
  })
}

// ----------------------------------------------------------------------------- subjects

export function useSubjects() {
  return useQuery({
    queryKey: keys.subjects,
    queryFn: async () => unwrap(await api.GET('/api/subjects')) as Subject[],
  })
}

export function useSubject(id: number) {
  return useQuery({
    queryKey: keys.subject(id),
    queryFn: async () => unwrap(await api.GET('/api/subjects/{subject_id}', { params: { path: { subject_id: id } } })) as Subject,
    enabled: Number.isFinite(id),
  })
}

export function useCreateSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SubjectCreate) => unwrap(await api.POST('/api/subjects', { body })) as Subject,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.subjects }),
  })
}

export function useUpdateSubject(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SubjectUpdate) =>
      unwrap(await api.PATCH('/api/subjects/{subject_id}', { params: { path: { subject_id: id } }, body })) as Subject,
    onSuccess: (subject) => {
      qc.setQueryData(keys.subject(id), subject)
      qc.invalidateQueries({ queryKey: keys.subjects }); qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      unwrap(await api.DELETE('/api/subjects/{subject_id}', { params: { path: { subject_id: id } } }))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.subjects }),
  })
}

// ----------------------------------------------------------------------------- plans

export function usePlans(subjectId?: number) {
  return useQuery({
    queryKey: [...keys.plans, subjectId ?? 'all'],
    queryFn: async () => unwrap(await api.GET('/api/plans', { params: { query: { subject_id: subjectId } } })) as PlanSummary[],
  })
}

export function usePlan(id: number) {
  return useQuery({
    queryKey: keys.plan(id),
    queryFn: async () => unwrap(await api.GET('/api/plans/{plan_id}', { params: { path: { plan_id: id } } })) as PlanDetail,
    enabled: Number.isFinite(id),
  })
}

export function useUpdatePlan(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: PlanUpdate) =>
      unwrap(await api.PATCH('/api/plans/{plan_id}', { params: { path: { plan_id: id } }, body })) as PlanDetail,
    onSuccess: (plan) => {
      qc.setQueryData(keys.plan(id), plan)
      qc.invalidateQueries({ queryKey: keys.subjects }); qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeletePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      unwrap(await api.DELETE('/api/plans/{plan_id}', { params: { path: { plan_id: id } } }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.subjects }); qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: keys.plans })
    },
  })
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: async (body: ImportPreviewRequest) => unwrap(await api.POST('/api/plans/import/preview', { body })) as ImportPreview,
  })
}

export function useImportPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ImportRequest) => unwrap(await api.POST('/api/plans/import', { body })) as ImportResult,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: keys.subjects }); qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: keys.plans })
      qc.invalidateQueries({ queryKey: keys.plan(result.plan_id) })
    },
  })
}

export async function fetchGenerationPrompt(params: {
  topic: string
  context?: string
  language?: string
  exam_date?: string | null
  node_count?: string
}): Promise<string> {
  const r = unwrap(await api.GET('/api/plans/generation-prompt', { params: { query: params } }))
  return r.prompt
}

export function exportUrl(planId: number, includeProgress: boolean) {
  return `/api/plans/${planId}/export?include_progress=${includeProgress}&include_notes=${includeProgress}`
}

// ----------------------------------------------------------------------------- nodes

export function useNode(id: number | null) {
  return useQuery({
    queryKey: keys.node(id ?? -1),
    queryFn: async () => unwrap(await api.GET('/api/nodes/{node_id}', { params: { path: { node_id: id as number } } })) as NodeDetail,
    enabled: id !== null,
  })
}

function patchPlanNode(qc: ReturnType<typeof useQueryClient>, planId: number, node: PlanNode) {
  qc.setQueryData<PlanDetail>(keys.plan(planId), (old) =>
    old ? { ...old, nodes: old.nodes.map((n) => (n.id === node.id ? { ...n, ...node } : n)) } : old,
  )
}

export function useSetStatus(planId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nodeId, status }: { nodeId: number; status: Status }) =>
      unwrap(await api.PUT('/api/nodes/{node_id}/progress', { params: { path: { node_id: nodeId } }, body: { status } })) as PlanNode,
    onMutate: async ({ nodeId, status }) => {
      await qc.cancelQueries({ queryKey: keys.plan(planId) })
      const previous = qc.getQueryData<PlanDetail>(keys.plan(planId))
      qc.setQueryData<PlanDetail>(keys.plan(planId), (old) =>
        old
          ? { ...old, nodes: old.nodes.map((n) => (n.id === nodeId ? { ...n, progress: { ...n.progress, status } } : n)) }
          : old,
      )
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.plan(planId), ctx.previous)
    },
    onSuccess: (node) => {
      patchPlanNode(qc, planId, node)
      qc.invalidateQueries({ queryKey: keys.node(node.id) })
    },
    onSettled: () => {
      // readiness of other nodes changes -> refetch whole plan (cheap) + subject summaries
      qc.invalidateQueries({ queryKey: keys.plan(planId) })
      qc.invalidateQueries({ queryKey: keys.subjects }); qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateNode(planId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nodeId, body }: { nodeId: number; body: NodeUpdate }) =>
      unwrap(await api.PATCH('/api/nodes/{node_id}', { params: { path: { node_id: nodeId } }, body })) as PlanNode,
    onSuccess: (node) => {
      patchPlanNode(qc, planId, node)
      qc.invalidateQueries({ queryKey: keys.node(node.id) })
    },
  })
}

export function useSaveNote(planId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nodeId, content }: { nodeId: number; content: string }) =>
      unwrap(await api.PUT('/api/nodes/{node_id}/note', { params: { path: { node_id: nodeId } }, body: { content } })),
    onSuccess: (note, { nodeId, content }) => {
      qc.setQueryData<NodeDetail>(keys.node(nodeId), (old) => (old ? { ...old, note, has_note: content.trim().length > 0 } : old))
      qc.setQueryData<PlanDetail>(keys.plan(planId), (old) =>
        old ? { ...old, nodes: old.nodes.map((n) => (n.id === nodeId ? { ...n, has_note: content.trim().length > 0 } : n)) } : old,
      )
    },
  })
}

// ----------------------------------------------------------------------------- exercises

export function useExercises(params: { subject_id?: number; node_id?: number }, enabled = true) {
  return useQuery({
    queryKey: keys.exercises(params),
    queryFn: async () => unwrap(await api.GET('/api/exercises', { params: { query: params } })) as ExerciseListItem[],
    enabled,
  })
}

export function useExercise(id: number | null) {
  return useQuery({
    queryKey: keys.exercise(id ?? -1),
    queryFn: async () => unwrap(await api.GET('/api/exercises/{exercise_id}', { params: { path: { exercise_id: id as number } } })) as Exercise,
    enabled: id !== null,
  })
}

export function useAddAttempt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ exerciseId, body }: { exerciseId: number; body: AttemptCreate }) =>
      unwrap(await api.POST('/api/exercises/{exercise_id}/attempts', { params: { path: { exercise_id: exerciseId } }, body })) as Exercise,
    onSuccess: (exercise) => {
      qc.setQueryData(keys.exercise(exercise.id), exercise)
      qc.invalidateQueries({ queryKey: ['exercises'] })
      qc.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}
