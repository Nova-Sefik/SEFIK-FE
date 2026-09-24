import { lazy, Suspense, useEffect, useState } from 'react'
import { LiveDataProvider } from './live/LiveDataContext'

const App = lazy(() => import('./App'))
const AssistantPage = lazy(() => import('./assistant/AssistantPage'))
const OverviewPage = lazy(() => import('./overview/OverviewPage'))

// Lightweight hash routing keeps the prototype deployable as a static site.
export default function Root() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  let page = <App />
  if (hash.startsWith('#/assistant')) page = <AssistantPage />
  if (hash.startsWith('#/overview')) page = <OverviewPage />
  return (
    <LiveDataProvider>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-page text-sm text-ink-3">Loading Sefik…</div>}>
        {page}
      </Suspense>
    </LiveDataProvider>
  )
}
