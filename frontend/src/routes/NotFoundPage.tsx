import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl font-semibold tracking-tight text-fg-subtle">404</p>
      <p className="text-fg-muted">{t('errors.notFound')}</p>
      <Button asChild variant="outline">
        <Link to="/">{t('nav.home')}</Link>
      </Button>
    </div>
  )
}
