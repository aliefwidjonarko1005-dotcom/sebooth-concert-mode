import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useButtonHintsOverride } from '../ButtonRail/ButtonRail'
import styles from './PrintQuantityModal.module.css'

interface PrintQuantityModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: (quantity: number) => void
    initialQuantity?: number
}

export function PrintQuantityModal({ isOpen, onClose, onConfirm, initialQuantity = 2 }: PrintQuantityModalProps): JSX.Element | null {
    const [quantity, setQuantity] = useState(initialQuantity)

    // Physical buttons: 1 = fewer (cancel at the minimum), 2 = more, 3 = print (3 is always forward).
    // The rail shows the same labels while open; handled in capture phase so the page underneath stays put.
    const stateRef = useRef({ quantity, onClose, onConfirm })
    stateRef.current = { quantity, onClose, onConfirm }

    useButtonHintsOverride(isOpen ? {
        1: { label: quantity <= 2 ? 'Batal' : 'Kurangi' },
        2: { label: 'Tambah cetak' },
        3: { label: `Cetak ${quantity} foto`, primary: true }
    } : null)

    useEffect(() => {
        if (!isOpen) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== '1' && e.key !== '2' && e.key !== '3') return
            e.preventDefault()
            e.stopImmediatePropagation()
            const { quantity: q, onClose: close, onConfirm: confirm } = stateRef.current
            if (e.key === '1') {
                if (q <= 2) close()
                else setQuantity(q - 2)
            } else if (e.key === '2') {
                setQuantity(q + 2)
            } else {
                confirm(q)
                close()
            }
        }
        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [isOpen])

    if (!isOpen) return null

    const handleIncrement = () => {
        setQuantity(prev => prev + 2)
    }

    const handleDecrement = () => {
        setQuantity(prev => Math.max(2, prev - 2))
    }

    const handleConfirm = () => {
        console.log('[PrintQuantityModal] Confirm clicked with quantity:', quantity)
        onConfirm(quantity)
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
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={e => e.stopPropagation()}
                >
                    <button className={styles.closeBtn} onClick={onClose}>
                        ×
                    </button>

                    <h2 className={styles.title}>Mau cetak berapa foto?</h2>
                    <p className={styles.subtitle}>
                        Kelipatan 2: satu lembar cetak berisi 2 photostrip
                    </p>

                    <div className={styles.quantitySelector}>
                        <button
                            className={styles.quantityBtn}
                            onClick={handleDecrement}
                            disabled={quantity <= 2}
                        >
                            −
                        </button>
                        <span className={styles.quantityDisplay}>{quantity}</span>
                        <button
                            className={styles.quantityBtn}
                            onClick={handleIncrement}
                        >
                            +
                        </button>
                    </div>
                    <p className={styles.sheets}>{quantity / 2} lembar cetak</p>

                    <div className={styles.actions}>
                        <button
                            className={styles.cancelBtn}
                            onClick={onClose}
                        >
                            Batal
                        </button>
                        <button
                            className={styles.confirmBtn}
                            onClick={handleConfirm}
                        >
                            Cetak {quantity} Foto
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}