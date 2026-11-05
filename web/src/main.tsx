import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LazyMotion, MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { routes } from '@/app/routes'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/Toast'
import { isRetryable } from '@/data/errors'
import '@/locales/i18n'
import { applyMotionTokens } from '@/motion/tokens'
import '@/styles/tokens.css'

applyMotionTokens()

const motionFeatures = () => import('@/motion/features').then((module) => module.default)

// Patient data lives in memory only and is cleared on sign-out; nothing here is written to browser storage.
const queries = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: (failures, error) => failures < 2 && isRetryable(error) } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LazyMotion features={motionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queries}>
          <AuthProvider>
            <RouterProvider router={createBrowserRouter(routes)} />
            <Toaster />
          </AuthProvider>
        </QueryClientProvider>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
)
