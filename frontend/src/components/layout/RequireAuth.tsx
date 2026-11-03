import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { UNAUTHORIZED_EVENT } from '@/api/client'
import { keys, useMe } from '@/api/hooks'
import { Spinner } from '@/components/ui/misc'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe()
  const location = useLocation()
  const qc = useQueryClient()

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(keys.me, null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [qc])

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center text-fg-muted">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
