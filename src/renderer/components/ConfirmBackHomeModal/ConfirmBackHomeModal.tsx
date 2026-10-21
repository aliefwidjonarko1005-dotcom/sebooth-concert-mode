import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useButtonHintsOverride } from '../ButtonRail/ButtonRail'
import styles from './ConfirmBackHomeModal.module.css'

interface ConfirmBackHomeModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
}

/**
 * "Cancel the session?" dialog, driven by the physical buttons:
 * 1 = yes, cancel (a second press of the key that usually opens it), 3 = keep going (3 is always forward).
 * Buttons are stacked top→bottom like the physical 1 / 3 and the rail shows the same labels while open.
 */
export function ConfirmBackHomeModal({ isOpen, onClose, onConfirm }: ConfirmBackHomeModalProps): JSX.Element | null {
    // Latest callbacks for the key listener without re-subscribing every render
    const actionsRef = useRef({ onClose, onConfirm })
    actionsRef.current = { onClose, onConfirm }

    useButtonHintsOverride(isOpen ? { 1: { label: 'Ya, batalkan' }, 3: { label: 'Lanjutkan', primary: true } } : null)

    useEffect(() => {
        if (!isOpen) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== '1' && e.key !== '2' && e.key !== '3') return
            // Capture phase: the page underneath must not also act on this press
            e.preventDefault()
            e.stopImmediatePropagation()
            if (e.key === '1') {
                actionsRef.current.onConfirm()
                actionsRef.current.onClose()
            } else if (e.key === '3') {
                actionsRef.current.onClose()
            }
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [isOpen])

    if (!isOpen) return null

    const handleConfirm = () => {
        onConfirm()
        onClose()
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
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    onClick={e => e.stopPropagation()}
                    role="alertdialog"
                    aria-labelledby="confirm-home-title"
                >
                    <h2 id="confirm-home-title" className={styles.title}>Batalkan sesi?</h2>
                    <p className={styles.subtitle}>
                        Sesi ini dihentikan dan layar kembali ke beranda.
                    </p>

                    <div className={styles.actions}>
                        <button className={styles.cancelBtn} onClick={handleConfirm}>
                            <span className={styles.key}>1</span>
                            Ya, batalkan
                        </button>
                        <button className={styles.confirmBtn} onClick={onClose} autoFocus>
                            <span className={styles.key}>3</span>
                            Lanjutkan
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}
