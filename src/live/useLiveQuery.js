import { useEffect, useRef, useState } from 'react'

export default function useLiveQuery(key, query, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, fetching: false })
  const previous = useRef(null)

  useEffect(() => {
    if (!enabled) {
      setState((current) => ({ ...current, loading: false, fetching: false }))
      return undefined
    }
    let active = true
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: !current.data, fetching: true, error: null }))
    query(controller.signal)
      .then((data) => {
        if (!active) return
        previous.current = data
        setState({ data, error: null, loading: false, fetching: false })
      })
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return
        setState((current) => ({ data: current.data ?? previous.current, error, loading: false, fetching: false }))
      })
    return () => {
      active = false
      controller.abort()
    }
    // query is intentionally represented by the stable serialized key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  return state
}
