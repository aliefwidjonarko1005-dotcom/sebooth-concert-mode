import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './EmailModal.module.css'

interface EmailModalProps {
    isOpen: boolean
    onClose: () => void
    onSend: (email: string) => Promise<{ success: boolean; error?: string }>
    isSending: boolean
}

export function EmailModal({ isOpen, onClose, onSend, isSending }: EmailModalProps): JSX.Element | null {
    const [email, setEmail] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    if (!isOpen) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            setError('Please enter a valid email address')
            return
        }

        try {
            const result = await onSend(email)

            if (result.success) {
                setSuccess(true)
                setTimeout(() => {
                    onClose()
                    setEmail('')
                    setSuccess(false)
                }, 2000)
            } else {
                setError(result.error || 'Failed to send email')
            }
        } catch (err) {
            console.error('EmailModal send error:', err)
            setError('Send failed: ' + (err instanceof Error ? err.message : String(err)))
        }
    }

    return (
        <AnimatePresence>
            <motion.div
                className={styles.overlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            >
                <motion.div
                    className={styles.modal}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={e => e.stopPropagation()}
                >
                    <button className={styles.closeBtn} onClick={onClose}>
                        ×
                    </button>

                    <h2 className={styles.title}>Send to Email</h2>
                    <p className={styles.subtitle}>
                        Receive your photos directly in your inbox
                    </p>

                    {success ? (
                        <div className={styles.successState}>
                            <span className={styles.successIcon}>✅</span>
                            <h3>Email Sent!</h3>
                            <p>Check your inbox for your photos</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className={styles.form}>
                            <div className={styles.inputGroup}>
                                <label htmlFor="email">Email Address</label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="your.email@example.com"
                                    disabled={isSending}
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className={styles.error}>
                                    <span></span> {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                className={styles.sendBtn}
                                disabled={isSending || !email}
                            >
                                {isSending ? (
                                    <>
                                        <span className={styles.spinner}></span>
                                        Sending...
                                    </>
                                ) : (
                                    <>Send Photos</>
                                )}
                            </button>

                            <p className={styles.hint}>
                                We'll send the photo strip, individual photos, and a link to view more
                            </p>
                        </form>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}
