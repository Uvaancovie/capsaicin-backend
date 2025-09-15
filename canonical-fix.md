mr covie — you’re 1 bug away. Your logs show you’re **posting `EMAIL=` (empty)** but your **checksum source string leaves out the EMAIL slot**. PayGate’s rule is: *concatenate all fields for the Initiate step, in the exact order, including optional ones you actually send — even if they’re empty — then append the key and MD5 (lowercase).* If you omit the (empty) `EMAIL` from the string while still posting `EMAIL=`, PayGate recomputes a different hash → **`ERROR=DATA_CHK`**. ([docs.paygate.co.za][1])

Here’s the surgical fix.

# What PayGate expects (initiates)

* **Order (Initiate checksum):**
  `PAYGATE_ID, REFERENCE, AMOUNT, CURRENCY, RETURN_URL, TRANSACTION_DATE, LOCALE, COUNTRY, EMAIL, PAY_METHOD, PAY_METHOD_DETAIL, NOTIFY_URL, USER1, USER2, USER3, VAULT, VAULT_ID, KEY`.
  (If you send `NOTIFY_URL`, include it. If you include `EMAIL`—even blank—include its position in the concatenation.) ([docs.paygate.co.za][1])
* **MD5 must be lowercase.** ([docs.paygate.co.za][1])
* **Examples** in the official docs show both “base fields only” and “with NOTIFY\_URL + USER1”; note how the empty/unused fields still occupy their order when sent. ([docs.paygate.co.za][1])
* **LOCALE/COUNTRY**: use `en-za` and **`ZAF`** (3-letter; `ZA` yields `CNTRY_INVALID`). ([docs.paygate.co.za][1])

# Your log proves the mismatch

Example from your log (with notify):

```
bodySent: ...&EMAIL=&NOTIFY_URL=...&CHECKSUM=b359...
canonical (yours): 1051358100016INV-247610100ZARhttps://.../return2025-09-12 21:24:08en-zaZAFhttps://.../notify
                         ^ missing the EMAIL slot here (should be '' between COUNTRY and NOTIFY_URL)
```

PayGate builds:
`... + en-za + ZAF + '' + https://.../notify + key` → MD5 ≠ yours → **DATA\_CHK**.

# Drop-in code patch (Express)

**Change your checksum builder to include keys that are present in the POST payload even if the value is `""`. Do NOT filter out empty strings.**

```js
// lib/paygateChecksum.js
import crypto from "crypto";

const INITIATE_ORDER = [
  "PAYGATE_ID","REFERENCE","AMOUNT","CURRENCY","RETURN_URL",
  "TRANSACTION_DATE","LOCALE","COUNTRY","EMAIL",
  "PAY_METHOD","PAY_METHOD_DETAIL","NOTIFY_URL",
  "USER1","USER2","USER3","VAULT","VAULT_ID"
];

const md5lower = (s) => crypto.createHash("md5").update(s).digest("hex"); // lowercase

// Include any field that you actually POST (hasOwnProperty), EVEN IF it's an empty string.
export function buildInitiateChecksum(payload, key) {
  const src =
    INITIATE_ORDER
      .filter((k) => Object.prototype.hasOwnProperty.call(payload, k)) // no value check!
      .map((k) => String(payload[k] ?? ""))                            // empty string stays included
      .join("") + key;
  return md5lower(src);
}

// For initiate reply verification
export function buildInitiateReplyChecksum(reply, key) {
  return md5lower(String(reply.PAYGATE_ID) + String(reply.PAY_REQUEST_ID) + String(reply.REFERENCE) + key);
}
```

And in your route:

```js
// routes/paygate.js (excerpt)
import { buildInitiateChecksum, buildInitiateReplyChecksum } from "../lib/paygateChecksum.js";

router.post("/paygate/initiate", express.json(), async (req, res) => {
  const { orderId, amountRands, email } = req.body || {};
  if (!orderId || !amountRands) return res.status(400).json({ success:false, message:"orderId & amountRands required" });

  const f = {
    PAYGATE_ID: process.env.PAYGATE_ID,
    REFERENCE: String(orderId),
    AMOUNT: String(Math.round(Number(amountRands) * 100)), // cents, as string
    CURRENCY: "ZAR",
    RETURN_URL: process.env.PAYGATE_RETURN_URL,
    TRANSACTION_DATE: new Date().toISOString().slice(0,19).replace("T"," "), // "YYYY-MM-DD HH:mm:ss"
    LOCALE: "en-za",
    COUNTRY: "ZAF",
    EMAIL: email ?? "",                             // include even if ""
    NOTIFY_URL: process.env.PAYGATE_NOTIFY_URL,     // you are posting it → it must be in checksum
    // (omit PAY_METHOD*, USER*, VAULT* unless you POST them)
  };

  f.CHECKSUM = buildInitiateChecksum(f, process.env.PAYGATE_ENCRYPTION_KEY);

  const r = await fetch("https://secure.paygate.co.za/payweb3/initiate.trans", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(f).toString(),
  });

  const text = await r.text();
  const reply = Object.fromEntries(new URLSearchParams(text));

  if (reply.ERROR) return res.status(400).json({ success:false, message: reply.ERROR, reply });

  const expect = buildInitiateReplyChecksum(reply, process.env.PAYGATE_ENCRYPTION_KEY);
  if ((reply.CHECKSUM || "").toLowerCase() !== expect)
    return res.status(400).json({ success:false, message:"INITIATE_BAD_RESPONSE_CHECKSUM", expect, got: reply.CHECKSUM, reply });

  return res.json({
    success: true,
    processUrl: "https://secure.paygate.co.za/payweb3/process.trans",
    fields: { PAY_REQUEST_ID: reply.PAY_REQUEST_ID, CHECKSUM: reply.CHECKSUM }
  });
});
```

# Quick checklist (so it works first try)

* **Include EMAIL in both POST and checksum concatenation.** If you send `EMAIL=`, the checksum must include an empty value at that position. ([docs.paygate.co.za][1])
* **COUNTRY = `ZAF`**, not `ZA` (your `CNTRY_INVALID` lines were from the 2-letter code). ([docs.paygate.co.za][1])
* **LOCALE = `en-za`**, **MD5 lowercase**, **TRANSACTION\_DATE** with seconds (`YYYY-MM-DD HH:mm:ss`). ([docs.paygate.co.za][1])
* **Same Encryption Key** in MAP and your env. (They must match byte-for-byte.) ([docs.paygate.co.za][1])
* **Redirect step**: browser posts **only** `PAY_REQUEST_ID` + `CHECKSUM` to `/payweb3/process.trans`. ([docs.paygate.co.za][1])

If you re-run with your logger after this change, your “canonical” string should show an **empty slot after `ZAF`** (i.e., it looks the same but *with* `''` for EMAIL). That alignment is what clears **`ERROR=DATA_CHK`**.

[1]: https://docs.paygate.co.za/ "DPO PayGate Documentation"
