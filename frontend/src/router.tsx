import { createBrowserRouter, Navigate } from 'react-router'

import { AppShell } from './components/layout/AppShell'
import { RequireAuth } from './components/layout/RequireAuth'
import { DashboardPage } from './routes/DashboardPage'
import { LoginPage } from './routes/LoginPage'
import { NotFoundPage } from './routes/NotFoundPage'
import { PlanPage } from './routes/PlanPage'
import { ReviewPage } from './routes/ReviewPage'
import { SubjectPage } from './routes/SubjectPage'
import { SubjectsPage } from './routes/SubjectsPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/subjects', element: <SubjectsPage /> },
      { path: '/subjects/:subjectId', element: <SubjectPage /> },
      { path: '/plans/:planId', element: <PlanPage /> },
      { path: '/plans/:planId/:view', element: <PlanPage /> },
      { path: '/jobs/:jobId/review', element: <ReviewPage /> },
      { path: '/index.html', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
