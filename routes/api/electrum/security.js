const PUBLIC_PREFLIGHT_FIELDS = Object.freeze([
  "chainTicker",
  "to",
  "from",
  "balance",
  "value",
  "fee",
  "feePerByte",
  "total",
  "remainingBalance",
  "warnings",
  "interest",
]);

const toPublicPreflightResult = (preflightResult) => {
  if (
    preflightResult == null ||
    typeof preflightResult !== "object" ||
    Array.isArray(preflightResult)
  ) {
    throw new Error("Invalid Electrum preflight result");
  }

  return PUBLIC_PREFLIGHT_FIELDS.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(preflightResult, field)) {
      result[field] = preflightResult[field];
    }
    return result;
  }, {});
};

module.exports = {
  PUBLIC_PREFLIGHT_FIELDS,
  toPublicPreflightResult,
};
