import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from './client'
import { keys } from './hooks'
import type { Document, Exercise, ExerciseCreate, ExerciseDraft, ExerciseUpdate, FigureDraft, Job, JobDetail, StartExtractionRequest, SubjectNode } from './types'

export const docKeys = {
  documents: (subjectId: number) => ['documents', subjectId] as const,
  document: (id: number) => ['documents', 'one', id] as const,
  jobs: (documentId: number) => ['jobs', 'doc', documentId] as const,
  job: (id: number) => ['jobs', id] as const,
  subjectNodes: (subjectId: number) => ['subjects', subjectId, 'nodes'] as const,
}

const ACTIVE: Job['status'][] = ['pending', 'running']
export const isActiveJob = (job?: Job | null) => !!job && ACTIVE.includes(job.status)

export function useDocuments(subjectId: number) {
  return useQuery({
    queryKey: docKeys.documents(subjectId),
    queryFn: async () => unwrap(await api.GET('/api/documents', { params: { query: { subject_id: subjectId } } })) as Document[],
    refetchInterval: (q) => (q.state.data?.some((d) => isActiveJob(d.latest_job)) ? 2000 : false),
  })
}

export function useDocument(id: number) {
  return useQuery({
    queryKey: docKeys.document(id),
    queryFn: async () => unwrap(await api.GET('/api/documents/{document_id}', { params: { path: { document_id: id } } })) as Document,
  })
}

export function useUploadDocument(subjectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      form.append('subject_id', String(subjectId))
      const res = await fetch('/api/documents', { method: 'POST', body: form, headers: { 'X-Requested-With': 'fetch' } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body.detail === 'string' ? body.detail : `Upload failed (${res.status})`)
      }
      return (await res.json()) as Document
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.documents(subjectId) }),
  })
}

export function useDeleteDocument(subjectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      unwrap(await api.DELETE('/api/documents/{document_id}', { params: { path: { document_id: id } } }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: docKeys.documents(subjectId) })
      qc.invalidateQueries({ queryKey: ['exercises'] })
    },
  })
}

export function useStartExtraction(subjectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ documentId, body }: { documentId: number; body: StartExtractionRequest }) =>
      unwrap(await api.POST('/api/documents/{document_id}/extract', { params: { path: { document_id: documentId } }, body })) as Job,
    onSuccess: () => qc.invalidateQueries({ queryKey: docKeys.documents(subjectId) }),
  })
}

export function useJobs(documentId: number) {
  return useQuery({
    queryKey: docKeys.jobs(documentId),
    queryFn: async () => unwrap(await api.GET('/api/jobs', { params: { query: { document_id: documentId } } })) as Job[],
    refetchInterval: (q) => (q.state.data?.some(isActiveJob) ? 2000 : false),
  })
}

export function useJob(id: number) {
  return useQuery({
    queryKey: docKeys.job(id),
    queryFn: async () => unwrap(await api.GET('/api/jobs/{job_id}', { params: { path: { job_id: id } } })) as JobDetail,
    refetchInterval: (q) => (isActiveJob(q.state.data) ? 1500 : false),
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => unwrap(await api.POST('/api/jobs/{job_id}/cancel', { params: { path: { job_id: id } } })) as Job,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      unwrap(await api.DELETE('/api/jobs/{job_id}', { params: { path: { job_id: id } } }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export async function saveDraft(jobId: number, exercises: ExerciseDraft[]): Promise<JobDetail> {
  return unwrap(await api.PUT('/api/jobs/{job_id}/draft', { params: { path: { job_id: jobId } }, body: { exercises } })) as JobDetail
}

export async function cropFigure(jobId: number, page: number, bbox: number[], caption = ''): Promise<FigureDraft> {
  return unwrap(await api.POST('/api/jobs/{job_id}/figures', { params: { path: { job_id: jobId } }, body: { page, bbox, caption } })) as FigureDraft
}

export function useCommitJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, exercises }: { jobId: number; exercises: ExerciseDraft[] }) =>
      unwrap(await api.POST('/api/jobs/{job_id}/commit', { params: { path: { job_id: jobId } }, body: { exercises } })),
    onSuccess: (_r, { jobId }) => {
      qc.invalidateQueries({ queryKey: docKeys.job(jobId) })
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['documents'] })
      qc.invalidateQueries({ queryKey: ['exercises'] })
      qc.invalidateQueries({ queryKey: keys.subjects })
    },
  })
}

export function useSubjectNodes(subjectId: number | undefined) {
  return useQuery({
    queryKey: docKeys.subjectNodes(subjectId ?? -1),
    queryFn: async () => unwrap(await api.GET('/api/subjects/{subject_id}/nodes', { params: { path: { subject_id: subjectId as number } } })) as SubjectNode[],
    enabled: subjectId !== undefined,
    staleTime: 60_000,
  })
}

export function pageImageUrl(documentId: number, page: number, zoom = 1.5) {
  return `/api/documents/${documentId}/pages/${page}?zoom=${zoom}`
}

// ----------------------------------------------------------------------------- exercise editing

export function useUpdateExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: ExerciseUpdate }) =>
      unwrap(await api.PATCH('/api/exercises/{exercise_id}', { params: { path: { exercise_id: id } }, body })) as Exercise,
    onSuccess: (exercise) => {
      qc.setQueryData(keys.exercise(exercise.id), exercise)
      qc.invalidateQueries({ queryKey: ['exercises'] })
      qc.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}

export function useDeleteExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      unwrap(await api.DELETE('/api/exercises/{exercise_id}', { params: { path: { exercise_id: id } } }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exercises'] })
      qc.invalidateQueries({ queryKey: ['nodes'] })
      qc.invalidateQueries({ queryKey: ['documents'] })
      qc.invalidateQueries({ queryKey: keys.subjects })
    },
  })
}

export function useCreateExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ExerciseCreate) => unwrap(await api.POST('/api/exercises', { body })) as Exercise,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exercises'] })
      qc.invalidateQueries({ queryKey: keys.subjects })
    },
  })
}
