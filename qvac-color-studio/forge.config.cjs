'use strict'

// The QVAC Forge plugin bundles the platform-specific Bare worker and native
// addons, forces `asar: false` (the worker cannot load from inside an asar),
// and prunes prebuilds for every platform except the target.
//
// macOS universal builds are not supported — package darwin-arm64 and
// darwin-x64 separately.
const QvacForgePlugin = require('@qvac/sdk/electron-forge')

module.exports = {
  packagerConfig: {
    name: 'QVAC Color Studio',
    // The webcam prompt macOS shows the user.
    extendInfo: {
      NSCameraUsageDescription:
        'Color Studio needs your camera to take the still it analyses. The photo never leaves this machine.'
    }
  },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] }],
  plugins: [new QvacForgePlugin({ logLevel: 'info' })]
}
