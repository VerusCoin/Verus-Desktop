const zcashParamsSources = {
  'z.cash': {
    spend: 'https://z.cash/downloads/sapling-spend.params',
    output: 'https://z.cash/downloads/sapling-output.params',
    groth16: 'https://z.cash/downloads/sprout-groth16.params',
  },
  'verus.io': {
    spend: 'https://verus.io/zcparams/sapling-spend.params',
    output: 'https://verus.io/zcparams/sapling-output.params',
    groth16: 'https://verus.io/zcparams/sprout-groth16.params',
  },
}

module.exports = zcashParamsSources;
