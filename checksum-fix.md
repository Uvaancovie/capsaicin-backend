mr covie — here’s a paste-ready prompt you can drop into **Copilot GPT-5 mini** (or a PR description) so it has all the context to fix the **PayGate PayWeb3 `ERROR=DATA_CHK`** on your checkout.

---

# 🛠️ Copilot Context: Fix PayGate PayWeb3 `ERROR=DATA_CHK` (Capsaicin)

**Repo(s):**

* Frontend (Next.js App Router): `capsaicin-frontend`
* Backend (Express/Mongo): `capsaicin-backend`

**Current symptom:**
`POST /paygate/initiate → 400` with body `{ success:false, message:"Checksum mismatch from PayGate", reply:{ ERROR:"DATA_CHK" } }`

**Root cause (PayWeb3 spec):**
For **PayWeb3 Initiate**, the **MD5 CHECKSUM must concatenate *every field you actually post*** in a strict order, then append the **Encryption Key**, then MD5 (lowercase). If you send `NOTIFY_URL`, `EMAIL`, `PAY_METHOD`, etc., they **must** be included in the checksum source; if you don’t send a field, you **must not** include it in the concatenation. Field names must be **UPPERCASE**. Endpoints are `…/payweb3/initiate.trans` → browser posts to `…/payweb3/process.trans`. The Notify callback must reply with plain `OK`. ([docs.paygate.co.za][1])

---

## What to implement (backend)

### 1) Use the documented field order (include only the ones you send)

**Initiate checksum order** per docs (base first, then optional):
`PAYGATE_ID, REFERENCE, AMOUNT, CURRENCY, RETURN_URL, TRANSACTION_DATE, LOCALE, COUNTRY, EMAIL, PAY_METHOD, PAY_METHOD_DETAIL, NOTIFY_URL, USER1, USER2, USER3, VAULT, VAULT_ID, +ENCRYPTION_KEY` → **MD5 (lowercase)**. ([docs.paygate.co.za][1])

> The docs also state: “The checksum in all cases is calculated by concatenating all the fields in the relevant step … An Encryption Key is appended and the resulting string is passed through an MD5 hash.” ([docs.paygate.co.za][1])

### 2) Build a deterministic checksum helper

Create a helper that:

* Has the ordered key list above.
* Filters to keys that are present & non-empty in the payload.
* Concatenates **values only** (no separators), appends the key, MD5 → **lowercase hex**.

```js
// lib/paygateChecksum.js
import crypto from "crypto";

const INITIATE_ORDER = [
  "PAYGATE_ID","REFERENCE","AMOUNT","CURRENCY","RETURN_URL",
  "TRANSACTION_DATE","LOCALE","COUNTRY","EMAIL",
  "PAY_METHOD","PAY_METHOD_DETAIL","NOTIFY_URL",
  "USER1","USER2","USER3","VAULT","VAULT_ID"
];

export function md5LowerHex(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

export function buildPayweb3InitiateChecksum(fields, encryptionKey) {
  const concat = INITIATE_ORDER
    .filter(k => fields[k] !== undefined && fields[k] !== null && String(fields[k]) !== "")
    .map(k => String(fields[k]))
    .join("") + encryptionKey;
  return md5LowerHex(concat);
}

export function buildPayweb3ResponseChecksum(reply, encryptionKey) {
  // For Initiate reply (not Notify): PAYGATE_ID + PAY_REQUEST_ID + REFERENCE + key
  const src = String(reply.PAYGATE_ID) + String(reply.PAY_REQUEST_ID) + String(reply.REFERENCE) + encryptionKey;
  return md5LowerHex(src);
}
```

### 3) Fix `/paygate/initiate`

* Post **UPPERCASE** fields to `https://secure.paygate.co.za/payweb3/initiate.trans`.
* `AMOUNT` must be **cents** (R1.00 → `"100"`).
* `TRANSACTION_DATE` format: `YYYY-MM-DD HH:mm:ss` (UTC acceptable).
* Compute `CHECKSUM` with the helper **including** any optional fields you actually send (e.g., `NOTIFY_URL`).
* Parse the K/V reply; if `ERROR` present, bubble it up; otherwise verify reply checksum and return `{ processUrl: process.trans, fields:{ PAY_REQUEST_ID, CHECKSUM } }`.
  Citations (endpoints, field names uppercase, examples): ([docs.paygate.co.za][1])

```js
// routes/paygate.js (handler core)
import { buildPayweb3InitiateChecksum, buildPayweb3ResponseChecksum } from "../lib/paygateChecksum.js";

router.post("/paygate/initiate", express.json(), async (req, res) => {
  const { orderId, amountRands, email = "buyer@example.com" } = req.body || {};
  if (!orderId || !amountRands) return res.status(400).json({ success:false, message:"orderId & amountRands required" });

  const f = {
    PAYGATE_ID: process.env.PAYGATE_ID,
    REFERENCE: String(orderId),
    AMOUNT: Math.round(Number(amountRands) * 100),     // cents
    CURRENCY: "ZAR",
    RETURN_URL: process.env.PAYGATE_RETURN_URL,
    TRANSACTION_DATE: new Date().toISOString().slice(0,19).replace("T"," "),
    LOCALE: "en-za",
    COUNTRY: "ZAF",
    EMAIL: email || "buyer@example.com",
    NOTIFY_URL: process.env.PAYGATE_NOTIFY_URL,        // include => must be in checksum
  };

  f.CHECKSUM = buildPayweb3InitiateChecksum(f, process.env.PAYGATE_ENCRYPTION_KEY);
  const body = new URLSearchParams(f).toString();

  const r = await fetch("https://secure.paygate.co.za/payweb3/initiate.trans", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body
  });
  const text = await r.text();
  if (!r.ok || /^</.test(text)) return res.status(502).json({ success:false, message:"INITIATE_HTTP_ERROR", status:r.status, bodyPreview:text.slice(0,400) });

  const reply = Object.fromEntries(new URLSearchParams(text));
  if (reply.ERROR) return res.status(400).json({ success:false, message:reply.ERROR, reply });

  const expect = buildPayweb3ResponseChecksum(reply, process.env.PAYGATE_ENCRYPTION_KEY);
  if ((reply.CHECKSUM || "").toLowerCase() !== expect) {
    return res.status(400).json({ success:false, message:"INITIATE_BAD_RESPONSE_CHECKSUM", expect, got:reply.CHECKSUM, reply });
  }

  return res.json({
    success: true,
    processUrl: "https://secure.paygate.co.za/payweb3/process.trans",
    fields: { PAY_REQUEST_ID: reply.PAY_REQUEST_ID, CHECKSUM: reply.CHECKSUM }
  });
});
```

### 4) Frontend redirect (App Router)

* After hitting `/paygate/initiate`, **POST only** `PAY_REQUEST_ID` and `CHECKSUM` to `https://secure.paygate.co.za/payweb3/process.trans` via a hidden form.
  (That’s the required browser step.) ([docs.paygate.co.za][1])

```tsx
// components/PayGateButton.tsx (client)
"use client";
import { useState } from "react";

export default function PayGateButton({ orderId, amountRands }:{ orderId:string; amountRands:number }) {
  const [form, setForm] = useState<any>(null);
  const start = async () => {
    const r = await fetch("https://capsaicin-backend.onrender.com/paygate/initiate", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ orderId, amountRands, email: "buyer@example.com" })
    });
    const data = await r.json();
    if (!data?.success) { console.error("PayGate initiate failed", data); alert("Payment init failed"); return; }
    setForm(data);
    setTimeout(() => document.getElementById("pg-form")?.dispatchEvent(new Event("submit")), 0);
  };
  return (
    <>
      <button onClick={start}>Proceed to Payment</button>
      {form?.processUrl && (
        <form id="pg-form" method="POST" action={form.processUrl} style={{display:"none"}}>
          <input type="hidden" name="PAY_REQUEST_ID" value={form.fields.PAY_REQUEST_ID}/>
          <input type="hidden" name="CHECKSUM" value={form.fields.CHECKSUM}/>
          <noscript><button type="submit">Continue</button></noscript>
        </form>
      )}
    </>
  );
}
```

### 5) Notify & Return

* **Notify**: if you set `NOTIFY_URL`, PayGate posts the **Response** fields to it and expects a plain-text `OK`. Verify MD5 over the **notify fields** (per docs), confirm amount and reference, then update order → respond `OK`. ([docs.paygate.co.za][1])
* **Return**: PayWeb redirects to your `RETURN_URL` with `TRANSACTION_STATUS`; use it to route to `/payment/success` or `/payment/cancel`. ([docs.paygate.co.za][1])

---

## Guardrails & gotchas (make Copilot enforce these)

* **Field names:** **UPPERCASE** in all posts to PayWeb3. ([docs.paygate.co.za][1])
* **Amounts:** **cents** (integer string). ([docs.paygate.co.za][1])
* **Date:** `YYYY-MM-DD HH:mm:ss`. ([docs.paygate.co.za][1])
* **Checksum casing:** **lowercase MD5 hex**. (Docs show lowercase in examples.) ([docs.paygate.co.za][1])
* **Endpoints:**

  * Initiate: `https://secure.paygate.co.za/payweb3/initiate.trans`
  * Redirect: `https://secure.paygate.co.za/payweb3/process.trans`
  * Query: `https://secure.paygate.co.za/payweb3/query.trans` ([docs.paygate.co.za][1])
* **Remove PayPage/HMAC paths** (that’s a different product; causes 403).
* **Env parity:** `PAYGATE_ENCRYPTION_KEY` **must match** the key set in MAP **PayWeb v3 Configure**. ([docs.paygate.co.za][1])

---

## Acceptance criteria

* `POST /paygate/initiate` returns `200` with:

  ```json
  { "success": true,
    "processUrl":"https://secure.paygate.co.za/payweb3/process.trans",
    "fields":{"PAY_REQUEST_ID":"…","CHECKSUM":"…"} }
  ```
* Hidden form successfully loads the PayGate hosted page.
* Completing payment triggers **Notify** to our server (prod URLs) and we reply `OK`. ([docs.paygate.co.za][1])
* No occurrences of `/paypage` or `HMAC` remain in code.
* Logs show successful MD5 verification on both Initiate **response** and Notify **payload**.

---

## References (spec)

* **PayWeb3 Endpoints, Request/Response, Field list, UPPERCASE names**; **Redirect posts only PAY\_REQUEST\_ID+CHECKSUM**; **Notify contract**. ([docs.paygate.co.za][1])
* **Security / Checksum rule:** concatenate all fields sent for the step, append key, MD5; merchant must verify response checksums. ([docs.paygate.co.za][1])

---

**Opinion (mr covie):** for speed and fewer regressions, keep the checksum builder centralized with a **single ordered key list**, and add a unit test that assembles a known example from the docs to a fixed MD5—this catches any future addition (like `USER1`) where a dev forgets to include it in the concatenation.

[1]: https://docs.paygate.co.za/ "DPO PayGate Documentation"
