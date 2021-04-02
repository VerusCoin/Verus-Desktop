const { randomBytes } = require('crypto');

const MasterSecret = randomBytes(32).toString('hex')
const BuiltinSecret = randomBytes(32).toString('hex')
const apiShieldKey = randomBytes(32).toString('hex')

module.exports = {
  MasterSecret,
  apiShieldKey,
  BuiltinSecret
}