import { RefObject, useEffect, useState } from 'react'

/**
 * Live content size of the element behind `ref` ({0,0} until measured).
 * Works when the element only mounts after the first render (pages that return null while loading).
 */
export function useElementSize(ref: RefObject<HTMLElement>): { width: number; height: number } {
    const [el, setEl] = useState<HTMLElement | null>(null)
    const [size, setSize] = useState({ width: 0, height: 0 })

    // Pick up the element once it exists (cheap identity check after each render)
    useEffect(() => {
        if (ref.current !== el) setEl(ref.current)
    })

    useEffect(() => {
        if (!el) return
        const ro = new ResizeObserver(([entry]) =>
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
        ro.observe(el)
        return () => ro.disconnect()
    }, [el])

    return size
}

/** Live content height of the element behind `ref` (0 until measured). */
export function useElementHeight(ref: RefObject<HTMLElement>): number {
    return useElementSize(ref).height
}
