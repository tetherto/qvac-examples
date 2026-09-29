'use strict'

// The QVAC Forge plugin bundles the platform-specific Bare worker and native
// addons, forces `asar: false` (the worker cannot load from inside an asar),
// and prunes prebuilds for every platform except the target.
//
// macOS universal builds are not supported: package darwin-arm64 and
// darwin-x64 separately.
const QvacForgePlugin = require('@qvac/sdk/electron-forge')

module.exports = {
  packagerConfig: {
    name: 'QVAC Biomarkers Demo',
    // The reference library and the sample CSV are read at runtime, so
    // they must travel with the build rather than being bundled into JS.
    extraResource: ['./data', './sample-bloodwork.csv']
  },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] }],
  plugins: [new QvacForgePlugin({ logLevel: 'info' })]
}
