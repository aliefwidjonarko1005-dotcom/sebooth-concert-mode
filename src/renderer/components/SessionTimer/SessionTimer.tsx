import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './SessionTimer.module.css'

interface SessionTimerProps {
    duration: number // seconds
    onTimeout: () => void
    enabled: boolean
    label?: string
}

export function SessionTimer({ duration, onTimeout, enabled, label = 'Session' }: SessionTimerProps): JSX.Element | null {
    const [timeLeft, setTimeLeft] = useState(duration)
    const [isWarning, setIsWarning] = useState(false)
    const onTimeoutRef = useRef(onTimeout)

    // Update ref when onTimeout changes
    useEffect(() => {
        onTimeoutRef.current = onTimeout
    }, [onTimeout])

    // Reset timer when duration changes
    useEffect(() => {
        setTimeLeft(duration)
    }, [duration])

    // Countdown logic
    useEffect(() => {
        if (!enabled) return

        const interval = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(interval)
                    onTimeoutRef.current()
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(interval)
    }, [enabled])

    // Warning when < 10 seconds
    useEffect(() => {
        setIsWarning(timeLeft <= 10 && timeLeft > 0)
    }, [timeLeft])

    // Reset timer function (can be called from parent via ref if needed)
    const resetTimer = useCallback(() => {
        setTimeLeft(duration)
    }, [duration])

    // Format time as MM:SS
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    if (!enabled) return null

    return (
        <AnimatePresence>
            <motion.div
                className={`${styles.timerOverlay} ${isWarning ? styles.warning : ''}`}
                initial={{ opacity: 0, y: -50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50 }}
            >
                <span className={styles.timerLabel}>{label}</span>
                <span className={styles.timerValue}>{formatTime(timeLeft)}</span>
            </motion.div>
        </AnimatePresence>
    )
}
