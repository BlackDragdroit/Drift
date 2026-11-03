import createClient, { type Middleware } from 'openapi-fetch'

import type { paths } from './schema'

export const UNAUTHORIZED_EVENT = 'app:unauthorized'

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    request.headers.set('X-Requested-With', 'fetch')
    return request
  },
  async onResponse({ response, request }) {
    if (response.status === 401 && !request.url.includes('/api/auth/')) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    }
    return response
  },
}

export const api = createClient<paths>({ baseUrl: '/' })
api.use(authMiddleware)

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : messageFromDetail(detail) || `Request failed (${status})`)
    this.status = status
    this.detail = detail
  }
}

function messageFromDetail(detail: unknown): string | undefined {
  if (Array.isArray(detail)) {
    const first = detail[0] as { message?: string; msg?: string } | undefined
    return first?.message ?? first?.msg
  }
  if (detail && typeof detail === 'object' && 'detail' in detail) {
    return messageFromDetail((detail as { detail: unknown }).detail)
  }
  return undefined
}

/** Unwrap an openapi-fetch result, throwing ApiError on failure. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    const err = result.error as { detail?: unknown } | undefined
    throw new ApiError(result.response.status, err?.detail ?? err ?? result.response.statusText)
  }
  return result.data as T
}
