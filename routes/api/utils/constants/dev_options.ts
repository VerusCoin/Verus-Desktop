const IS_TESTNET = false;
const ROOT_SYSTEM_ID = IS_TESTNET ? "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq" : "i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV";
const ROOT_SYSTEM_NAME = IS_TESTNET ? "VRSCTEST" : "VRSC";

module.exports = {
  IS_TESTNET,
  ROOT_SYSTEM_ID,
  ROOT_SYSTEM_NAME
}