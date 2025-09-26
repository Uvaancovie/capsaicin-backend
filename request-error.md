mr covie — the **/request-error** page means Ozow rejected your request before it could render checkout. With your latest logs, the #1 cause is: **your HashCheck was built from a string that didn’t exactly match the fields you POSTED** (you’re posting `Optional1..5` but your concat didn’t include them earlier). A single missing/extra field (even empty) or wrong order → **request-error**.

Do this—fastest path to green:

# 1) Go “minimal fields” for the first success

Only post the fields you need, and hash **exactly those**, in Ozow’s order:

```js
// routes/ozow.js (initiate) — SAFE MINIMAL PAYLOAD
const fields = {
  SiteCode: process.env.OZOW_SITE_CODE,      // e.g. CAP-CAP-035
  CountryCode: "ZA",
  CurrencyCode: "ZAR",
  Amount: Number(amountRands).toFixed(2),    // "479.00"
  TransactionReference: String(orderId),     // "INV-187347-H9Z0YU"
  BankReference: String(orderId).slice(-20), // "…H9Z0YU" (<=20 chars)
  // REMOVE Optional1..Optional5 entirely for now
  // Keep Customer simple (avoid < > while debugging)
  Customer: customer?.includes("@") ? customer : (customer || "customer"),
  CancelUrl: process.env.OZOW_CANCEL_URL,
  ErrorUrl: process.env.OZOW_ERROR_URL,
  SuccessUrl: process.env.OZOW_SUCCESS_URL,
  NotifyUrl: process.env.OZOW_NOTIFY_URL,
  IsTest: String(process.env.OZOW_IS_TEST === "true"),
};
```

**Important:** do **not** include `Optional1..Optional5` keys at all if they’re empty. If you include them, the hash must include them too (same position/order).

# 2) Hash exactly what you post (ordered, lowercased, SHA-512)

```js
// lib/ozowHash.js
import crypto from "crypto";

const REQUEST_ORDER = [
  "SiteCode","CountryCode","CurrencyCode","Amount","TransactionReference","BankReference",
  // "Optional1","Optional2","Optional3","Optional4","Optional5", // not posted ⇒ not in hash
  "Customer","CancelUrl","ErrorUrl","SuccessUrl","NotifyUrl","IsTest"
];

const sha512 = (s) => crypto.createHash("sha512").update(s).digest("hex");

export function buildOzowRequestHash(fields, privateKey) {
  const concat = REQUEST_ORDER
    .filter(k => Object.prototype.hasOwnProperty.call(fields, k))
    .map(k => String(fields[k] ?? ""))
    .join("") + String(privateKey || "");
  return sha512(concat.toLowerCase());
}
```

Log what you actually hashed:

```js
const concatPreview = REQUEST_ORDER
  .filter(k => Object.prototype.hasOwnProperty.call(fields, k))
  .map(k => String(fields[k] ?? ""))
  .join("") + process.env.OZOW_PRIVATE_KEY;

console.log("Ozow concat (lowercased):", concatPreview.toLowerCase());
console.log("Ozow HashCheck:", buildOzowRequestHash(fields, process.env.OZOW_PRIVATE_KEY));
```

# 3) Common gotchas to tick off

* **SiteCode** is the *site* code (e.g. `CAP-CAP-035`), **not** the merchant code.
* **IsTest** matches the site’s mode (prod site ⇒ `false`).
* **All four URLs** include `https://` and match your site setup:
  `https://www.capepharm.co.za/payment/{cancel|error|success}` and notify → your backend.
* **Amount** is a **2-dp string** (`"479.00"`).
* **BankReference** ≤ **20 chars**.
* **Post via HTML form** to `https://pay.ozow.com` (not `fetch`).
* If you later re-add `Optional1..5`, **either**:

  * include them in the POST **and** include them in the hash (in the documented order), **or**
  * don’t post them at all.

# 4) Quick “does my request work?” HTML (paste to test)

This proves it’s not your React code—just run after you compute fields+HashCheck on the server and return them to the browser.

```html
<form action="https://pay.ozow.com" method="POST" id="ozowForm">
  <!-- fill from your /ozow/initiate response -->
  <input name="SiteCode" value="CAP-CAP-035" />
  <input name="CountryCode" value="ZA" />
  <input name="CurrencyCode" value="ZAR" />
  <input name="Amount" value="479.00" />
  <input name="TransactionReference" value="INV-187347-H9Z0YU" />
  <input name="BankReference" value="INV-187347-H9Z0YU" />
  <input name="Customer" value="business@way2fly.net" />
  <input name="CancelUrl" value="https://www.capepharm.co.za/payment/cancel" />
  <input name="ErrorUrl" value="https://www.capepharm.co.za/payment/error" />
  <input name="SuccessUrl" value="https://www.capepharm.co.za/payment/success" />
  <input name="NotifyUrl" value="https://capsaicin-backend.onrender.com/ozow/notify" />
  <input name="IsTest" value="false" />
  <input name="HashCheck" value="PASTE_THE_SHA512" />
  <button>Pay with Ozow</button>
</form>
<script>document.getElementById('ozowForm').submit();</script>
```

# 5) If it still hits `/request-error`

* Log the **exact POST body** (names + values) and the **exact concat string** you hashed. Any field you post but didn’t include in the concat (or wrong order/case) will trigger the error.
* Try setting `Customer` to a plain email (no `<>`) just for bring-up.
* Double-check the Site’s configured URLs match the domain you’re sending.

---

If you paste your current **POSTed field list** (names only) and the **concat order** you’re using, I’ll line them up and point to the exact mismatch.
