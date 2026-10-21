import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useEffect } from 'react'
import { useAppConfig } from './stores'
import Landing from './pages/Landing'
import AdminDashboard from './pages/AdminDashboard'
import FrameSelection from './pages/FrameSelection'
import PaymentGateway from './pages/PaymentGateway'
import CaptureSession from './pages/CaptureSession'
import PhotoReviewPage from './pages/PhotoReviewPage'
import FinalizePage from './pages/FinalizePage'
import PickupCounter from './pages/PickupCounter'
import ReviewSession from './pages/ReviewSession'
import OutputPage from './pages/OutputPage'
import SharingPage from './pages/SharingPage'
import PrintingPage from './pages/PrintingPage'
import GalleryPage from './pages/GalleryPage'
import QueueDisplay from './pages/QueueDisplay'
import Tutorial from './pages/Tutorial'
import { ButtonRail } from './components/ButtonRail/ButtonRail'
import { CartoonBackdrop } from './components/CaptureArt/CaptureArt'
import { GuideTransition } from './components/GuideTransition/GuideTransition'
import { MascotAssistant } from './components/GuideTransition/MascotAssistant'

// Operator / back-office screens keep their own look (no cartoon stage)
const NO_ART_ROUTES = ['/admin', '/loket', '/gallery']
// Portrait pages whose bottom-left holds buttons or the preview: the corner mascot would sit under them
const PORTRAIT_BUSY_ROUTES = ['/tutorial', '/payment', '/capture', '/photo-review', '/review', '/output', '/finalize']

function App(): JSX.Element {
    const { config } = useAppConfig()
    const location = useLocation()
    const showArt = !NO_ART_ROUTES.some((r) => location.pathname.startsWith(r))
    // Tappable helper mascot: touch booth only, opt-in from Admin, never on the homepage
    const assistantOn = showArt && config.appOrientation !== 'portrait' && !!config.mascotAssistant && location.pathname !== '/'

    useEffect(() => {
        document.body.classList.toggle('kiosk-art-on', showArt)
    }, [showArt])

    useEffect(() => {
        const orientationClass = config.appOrientation === 'portrait' ? 'app-portrait' : 'app-landscape'
        document.body.classList.remove('app-portrait', 'app-landscape')
        document.body.classList.add(orientationClass)
    }, [config.appOrientation])

    useEffect(() => {
        const initCamera = async () => {
            try {
                const windowApi = (window as any).api
                if (config.cameraMode === 'mock') {
                    await windowApi.camera.useMock()
                } else if (config.cameraMode === 'ptp') {
                    await windowApi.camera.useDirectPtp()
                } else if (config.cameraMode === 'edsdk') {
                    await windowApi.camera.useCanonEdsdk()
                } else if (config.cameraMode === 'dslr') {
                    await windowApi.camera.useReal()
                }
            } catch (err) {
                console.error('Failed to initialize camera mode on startup:', err)
            }
        }
        initCamera()
    }, [config.cameraMode])
    const toggleFullScreen = async () => {
        try {
            await (window as any).api.window.toggleFullscreen()
        } catch (error) {
            console.error('Failed to toggle fullscreen:', error)
        }
    }

    return (
        <>
            {showArt && (
                <div className="kiosk-art">
                    {/* Touch booth pages (not the homepage, which has its own animation) get the lively stage */}
                    <CartoonBackdrop
                        lively={config.appOrientation !== 'portrait' && location.pathname !== '/'}
                        mascot={!assistantOn && !(config.appOrientation === 'portrait' && PORTRAIT_BUSY_ROUTES.includes(location.pathname))}
                    />
                </div>
            )}
            <AnimatePresence mode="wait">
                <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/queue" element={<QueueDisplay />} />
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/tutorial" element={<Tutorial />} />
                    <Route path="/frames" element={<FrameSelection />} />
                    <Route path="/payment" element={<PaymentGateway />} />
                    <Route path="/capture" element={<CaptureSession />} />
                    <Route path="/photo-review" element={<PhotoReviewPage />} />
                    <Route path="/finalize" element={<FinalizePage />} />
                    <Route path="/loket" element={<PickupCounter />} />
                    <Route path="/review" element={<ReviewSession />} />
                    <Route path="/output" element={<OutputPage />} />
                    <Route path="/sharing" element={<SharingPage />} />
                    <Route path="/printing" element={<PrintingPage />} />
                    <Route path="/gallery" element={<GalleryPage />} />
                </Routes>
            </AnimatePresence>

            <ButtonRail />
            {/* Mascot guide acts out each page change (both booths; shorter in portrait) */}
            <GuideTransition
                // Concert sessions run against the clock: no page-change acts there
                enabled={!config.concertMode}
                pace={config.appOrientation === 'portrait' ? 1.6 : 2.3}
                holdKeys={config.appOrientation === 'portrait'}
            />
            {/* Optional tappable helper (Admin toggle), touch booth only */}
            {assistantOn && <MascotAssistant />}

            <button
                onClick={toggleFullScreen}
                style={{
                    position: 'fixed',
                    bottom: '20px',
                    left: '20px',
                    zIndex: 9999,
                    background: 'rgba(0, 17, 58, 0.35)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    width: '36px',
                    height: '36px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.35
                }}
                title="Toggle Full Screen"
                aria-label="Toggle full screen"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                </svg>
            </button>
        </>
    )
}

export default App
