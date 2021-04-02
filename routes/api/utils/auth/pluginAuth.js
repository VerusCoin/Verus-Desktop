var blake2b = require('blake2b')
const crypto = require('crypto')

function generateAppSecret (permissions, masterSecret, appId) {
  let permissionsHashable = [...permissions]
  permissionsHashable.sort()

  var appSecret = blake2b(64)
  const handler = crypto.randomBytes(32)

  permissionsHashable.forEach(value => appSecret.update(Buffer.from(value)))
  appSecret.update(Buffer.from(masterSecret))
  appSecret.update(Buffer.from(appId))
  appSecret.update(Buffer.from(handler))

  return {
    secret: appSecret.digest('hex'),
    handler
  }
}

module.exports = {
  generateAppSecret
}