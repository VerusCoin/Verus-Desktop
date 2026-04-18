const {LOGIN_CONSENT_REQUEST_VDXF_KEY} = require('verus-typescript-primitives');

const CALLBACK_HOST = 'x-callback-url';

const SUPPORTED_V1_DLS = [LOGIN_CONSENT_REQUEST_VDXF_KEY.vdxfid];

module.exports = {
  SUPPORTED_V1_DLS,
  CALLBACK_HOST,
};
