// electron-builder afterPack: flip Electron fuses so a shipped Sebooth.exe cannot be turned into a
// plain Node runtime or debugger (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect) and only loads app.asar.
// EnableEmbeddedAsarIntegrityValidation stays off: on Windows it needs the integrity hash that only
// newer electron-builder versions embed; turning it on without one risks an app that will not start.
const path = require('path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

exports.default = async function afterPack(context) {
    const platform = context.electronPlatformName
    const name = context.packager.appInfo.productFilename
    const exe = platform === 'darwin'
        ? path.join(context.appOutDir, `${name}.app`)
        : path.join(context.appOutDir, platform === 'win32' ? `${name}.exe` : name)

    await flipFuses(exe, {
        version: FuseVersion.V1,
        resetAdHocDarwinSignature: platform === 'darwin',
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.EnableCookieEncryption]: true
    })
    console.log(`[afterPack] Electron fuses flipped on ${path.basename(exe)}`)
}
