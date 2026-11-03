import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'

import { ApiError } from '@/api/client'
import { useLogin, useMe } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'

export function LoginPage() {
  const { data: user } = useMe()
  const login = useLogin()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (user) return <Navigate to={location.state?.from ?? '/'} replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    login.mutate(password, {
      onSuccess: () => navigate(location.state?.from ?? '/', { replace: true }),
      onError: (err) => setError(err instanceof ApiError && err.status === 429 ? t('login.tooMany') : t('login.wrong')),
    })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/icon.svg" alt="" className="h-12 w-12 rounded-2xl shadow-card" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t('login.title')}</h1>
            <p className="mt-1 text-sm text-fg-muted">{t('login.subtitle')}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border bg-bg-elevated p-5 shadow-card">
          <div>
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input id="password" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={login.isPending || !password}>
            {login.isPending ? <Spinner /> : t('login.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
