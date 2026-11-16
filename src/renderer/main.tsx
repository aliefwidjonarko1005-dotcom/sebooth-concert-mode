import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import '@fontsource/bayon/400.css'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/500.css'
import '@fontsource/hanken-grotesk/700.css'
import '@fontsource/hanken-grotesk/800.css'
import '@fontsource/hanken-grotesk/900.css'
import './styles/global.css'
import './styles/brand.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        {/* Opt in to the v7 behaviour now: silences the two future-flag warnings on every start */}
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
        </HashRouter>
    </React.StrictMode>
)
