const crypto = require('crypto');

const OZOW_ORDER = [
  'SiteCode','CountryCode','CurrencyCode','Amount','TransactionReference','BankReference',
  'Optional1','Optional2','Optional3','Optional4','Optional5','Customer',
  'CancelUrl','ErrorUrl','SuccessUrl','NotifyUrl','IsTest'
];

function sha512HexLower(s) {
  return crypto.createHash('sha512').update(String(s).toLowerCase()).digest('hex');
}

function buildOzowHash(fields = {}, privateKey = '') {
  // include only fields that are present in fields (hasOwnProperty), in the OZOW_ORDER
  const src = OZOW_ORDER
    .filter(k => Object.prototype.hasOwnProperty.call(fields, k))
    .map(k => String(fields[k] ?? ''))
    .join('') + privateKey;
  // lowercase entire string then sha512
  return sha512HexLower(src);
}

function verifyOzowHash(receivedFields = {}, receivedHash = '', privateKey = '') {
  const computed = buildOzowHash(receivedFields, privateKey);
  return computed === (String(receivedHash || '').toLowerCase());
}

module.exports = { buildOzowHash, verifyOzowHash };
