import crypto from "crypto";

const INITIATE_ORDER = [
  "PAYGATE_ID","REFERENCE","AMOUNT","CURRENCY","RETURN_URL",
  "TRANSACTION_DATE","LOCALE","COUNTRY","EMAIL",
  "PAY_METHOD","PAY_METHOD_DETAIL","NOTIFY_URL",
  "USER1","USER2","USER3","VAULT","VAULT_ID"
];

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex"); // lowercase

export function buildInitiateChecksum(fields, key) {
  const src = INITIATE_ORDER
    .filter((k) => Object.prototype.hasOwnProperty.call(fields, k))  // include if POSTed…
    .map((k) => String(fields[k] ?? ""))                             // …even if empty ('')
    .join("") + key;
  return md5(src);
}

export function buildInitiateReplyChecksum(reply, key) {
  return md5(String(reply.PAYGATE_ID) + String(reply.PAY_REQUEST_ID) + String(reply.REFERENCE) + key);
}
