import { resolve } from 'path'
import { bytecodePlugin, defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    main: {
        // bytecodePlugin: production main/preload ship as V8 bytecode (Booth Guard logic lives in main).
        // It only runs for `electron-vite build`; dev keeps plain JS.
        plugins: [externalizeDepsPlugin(), bytecodePlugin()],
        resolve: {
            alias: {
                '@shared': resolve('src/shared')
            }
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin(), bytecodePlugin()],
        resolve: {
            alias: {
                '@shared': resolve('src/shared')
            }
        }
    },
    renderer: {
        resolve: {
            alias: {
                '@renderer': resolve('src/renderer'),
                '@shared': resolve('src/shared')
            }
        },
        plugins: [react()]
    }
})
