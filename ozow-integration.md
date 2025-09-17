mr covie — here’s a paste-ready **context markdown** that includes your **current Ozow keys** (⚠️ rotate them after you integrate, since they’ve been shared in chat). I’ve also pinned the exact field order, hash rule, and the hosted endpoint with sources.

---

# CONTEXT — Ozow Integration (Way2FlyDigital / Capsaicin)

**Frontend:** `https://capsaicin-frontend.vercel.app/` (Next.js)
**Backend:** `https://capsaicin-backend.onrender.com/` (Express)
**Processor:** **Ozow Pay by Bank** hosted form

## Merchant profile (live)

* **Business name:** CAPE FAMILY CHEM (PTY) LTD
* **Merchant Code:** `CAPEFAMILYCHEMPTYLTDC9ACF073A8`
* **Default Bank Account:** ABSA — 4105363103
* **Timezone:** Africa/Johannesburg (UTC+02:00)

> ℹ️ **SiteCode ≠ Merchant Code**. Ozow’s **SiteCode** is generated per site in the Merchant Admin and is the value you must post as `SiteCode`. Fetch it from **Dashboard → Merchant Admin → Sites**. ([Ozow][1])

---

## 🔐 Secrets (store server-side only)

> **Rotate after you plug these in.** Keep them out of the frontend bundle & repo.

```bash
# Render (backend) .env  — LIVE
OZOW_SITE_CODE=REPLACE_WITH_YOUR_SITE_CODE        # from Ozow Merchant Admin (not the Merchant Code)
OZOW_PRIVATE_KEY=5590125b084a4ff1bc8d3aa56f40986f # <— rotate after setup
OZOW_API_KEY=976a9566da0647b5ac110fdac875a0a3     # <— rotate after setup

OZOW_COUNTRY_CODE=ZA
OZOW_CURRENCY_CODE=ZAR
OZOW_IS_TEST=false

OZOW_SUCCESS_URL=https://capsaicin-frontend.vercel.app/payment/success
OZOW_CANCEL_URL=https://capsaicin-frontend.vercel.app/payment/cancel
OZOW_ERROR_URL=https://capsaicin-frontend.vercel.app/payment/error
OZOW_NOTIFY_URL=https://capsaicin-backend.onrender.com/ozow/notify
```

> Where to find / rotate keys: **Dashboard → Merchant Details** (API key & Private key). ([training.ozow.com][2])

---

## What the server must do (so we never get hash errors)

### 1) Compute `HashCheck` on initiate (server)

* **Concatenate** the post variables (exclude `HashCheck`) **in the order shown in Ozow’s “Post variables” table**
  `SiteCode, CountryCode, CurrencyCode, Amount, TransactionReference, BankReference, Optional1..Optional5, Customer, CancelUrl, ErrorUrl, SuccessUrl, NotifyUrl, IsTest`
* **Append** your **Private Key**
* **Lowercase** the entire string
* **SHA-512 → hex** ⇒ `HashCheck`
  Use the same rule to validate redirect/notification (`Hash`) on the way back (exclude `Hash` when verifying). ([Ozow][1])

### 2) Hosted form endpoint (live)

* **POST form to:** `https://pay.ozow.com` (hosted checkout). ([Ozow Pay][3])

### 3) Field definitions / constraints

* `SiteCode` is **per-site** (from Merchant Admin), not the Merchant Code.
* `Amount` is a **2-dp decimal string** (e.g., `"1.00"`).
* `BankReference` ≤ **20 chars** (keep it human-readable).
* `IsTest`: `"true"` for staging, `"false"` live.
  (Per Ozow’s integration table.) ([Ozow][1])

---

## Backend glue (what Copilot should generate)

* `lib/ozowHash.js`: helpers to build request/response hashes using the **ordered concatenation → +PrivateKey → lowercase → SHA-512** rule. ([Ozow][1])
* `routes/ozow.js`:

  * `POST /ozow/initiate`: build fields from env + payload (`orderId`, `amountRands`), compute `HashCheck`, return `{ action: "https://pay.ozow.com", method:"POST", fields }` to the client.
  * `POST /ozow/notify`: verify `Hash`, update Mongo order state, respond `OK`.
  * `GET /ozow/status/by-ref/:ref`: call **GetTransactionByReference** with header `ApiKey: <OZOW_API_KEY>` to reconcile status. ([Ozow][1])

---

## Frontend glue (Next.js)

* On **/checkout**, call `POST /ozow/initiate`, then render a hidden `<form action="https://pay.ozow.com" method="POST">` with the returned fields (including `HashCheck`) and **auto-submit**.
* Build simple pages for `/payment/success`, `/payment/cancel`, `/payment/error`. On success, optionally ping `/ozow/status/by-ref/:ref` for belt-and-braces reconciliation. ([Ozow][1])

---

## Quick smoke test

```json
POST /ozow/initiate
{
  "orderId": "INV-100001",
  "amountRands": 1.00,
  "bankRef": "INV100001",
  "customer": "buyer@example.com"
}
```

**Expected:** Server returns `{ action: "https://pay.ozow.com", fields: { SiteCode, ..., HashCheck } }`. Client auto-submits → Ozow hosted page. On completion, Ozow **redirects** and also **POSTs notify** to your backend. (If redirect vars look odd, always verify with **status API** using your `ApiKey`.) ([Ozow][1])

---

## Security & ops

* These keys are now considered **compromised** (they were posted). **Rotate both your Private Key & API Key** in Ozow **immediately after deployment** and update Render’s env. ([training.ozow.com][2])
* Never expose keys to the browser, never commit them, and consider adding a boot log “key hint” (first 2/last 2 chars) for sanity.
* Treat **Notify** as the source of truth; if in doubt, call **Status API** with `ApiKey`. ([Ozow][1])

---

### Sources

* Ozow integration guide (hash rule, variable order, redirects/notify, status). ([Ozow][1])
* Hosted payment URL (`pay.ozow.com`). ([Ozow Pay][3])
* SiteCode is generated per site (not Merchant Code). ([Ozow][1])
* Where to find/rotate **Private Key** & **API Key** in Dashboard. ([training.ozow.com][2])

---

If you want me to spit out the **exact `.env` + `ozowHash.js` + `ozow` route files** ready to drop into `capsaicin-backend`, say the word and I’ll output them verbatim with your values prefilled (plus a BIG “rotate now” banner).

[1]: https://ozow.com/integrations?utm_source=chatgpt.com "Payment Gateway Integration | Fast & Secure Solutions"
[2]: https://training.ozow.com/question/where-can-i-find-my-api-key-and-private-key/?utm_source=chatgpt.com "Where can I find my API key and private key?"
[3]: https://pay.ozow.com/?utm_source=chatgpt.com "Ozow Secure EFT Payments by Bank"

mr covie — lekker. Now that the CIPC format is fixed and you can **Add Site** (to get a **SiteCode**), here’s the exact way to wire Ozow into your codebase.

I’ll give you drop-in files for your **Express backend** (Render) and a tiny **Next.js** client component (Vercel). Keep your **Private Key + API Key server-side** only.

---

# 1) Backend env (Render)

Add these (replace placeholders):

```bash
# Render → Environment
OZOW_SITE_CODE=REPLACE_WITH_SITE_CODE         # from Ozow Dashboard → Sites (not Merchant Code)
OZOW_PRIVATE_KEY=REPLACE_WITH_PRIVATE_KEY     # Dashboard → Merchant Details (rotate after go-live)
OZOW_API_KEY=REPLACE_WITH_API_KEY             # for Status API calls

OZOW_COUNTRY_CODE=ZA
OZOW_CURRENCY_CODE=ZAR
OZOW_IS_TEST=false

OZOW_SUCCESS_URL=https://capsaicin-frontend.vercel.app/payment/success
OZOW_CANCEL_URL=https://capsaicin-frontend.vercel.app/payment/cancel
OZOW_ERROR_URL=https://capsaicin-frontend.vercel.app/payment/error
OZOW_NOTIFY_URL=https://capsaicin-backend.onrender.com/ozow/notify
```

> Ozow recommends verifying final state via **Status API** using your **ApiKey** header. Hosted form target is **`https://pay.ozow.com`**. ([ozow.com][1])

---

# 2) Backend helper — `lib/ozowHash.js`

```js
// lib/ozowHash.js
import crypto from "crypto";

/**
 * Per Ozow "Post variables" table order.
 * Include ONLY fields you actually POST (hasOwnProperty), but include even if "".
 */
export const OZOW_REQUEST_ORDER = [
  "SiteCode","CountryCode","CurrencyCode","Amount","TransactionReference","BankReference",
  "Optional1","Optional2","Optional3","Optional4","Optional5",
  "Customer","CancelUrl","ErrorUrl","SuccessUrl","NotifyUrl","IsTest"
];

/**
 * Response/Notify verification order (exclude Hash when verifying).
 */
export const OZOW_RESPONSE_ORDER = [
  "SiteCode","TransactionId","TransactionReference","Amount","Status",
  "Optional1","Optional2","Optional3","Optional4","Optional5",
  "CurrencyCode","IsTest","StatusMessage"
];

const sha512hex = (s) => crypto.createHash("sha512").update(s).digest("hex");

export function buildOzowRequestHash(fields, privateKey) {
  const concat = OZOW_REQUEST_ORDER
    .filter(k => Object.prototype.hasOwnProperty.call(fields, k))
    .map(k => String(fields[k] ?? "")) // include "" if posted
    .join("") + String(privateKey || "");
  return sha512hex(concat.toLowerCase()); // spec: lowercase then SHA-512
}

export function buildOzowResponseHash(fields, privateKey) {
  const concat = OZOW_RESPONSE_ORDER
    .filter(k => Object.prototype.hasOwnProperty.call(fields, k))
    .map(k => String(fields[k] ?? ""))
    .join("") + String(privateKey || "");
  return sha512hex(concat.toLowerCase());
}
```

---

# 3) Backend routes — `routes/ozow.js`

```js
// routes/ozow.js
import express from "express";
import fetch from "node-fetch";
import { buildOzowRequestHash, buildOzowResponseHash } from "../lib/ozowHash.js";

const router = express.Router();
const PAY_URL = "https://pay.ozow.com"; // hosted form target (live)

/** Start Ozow payment: server builds fields + HashCheck */
router.post("/ozow/initiate", express.json(), async (req, res) => {
  const { orderId, amountRands, bankRef = "", customer = "" } = req.body || {};
  if (!orderId || amountRands == null) {
    return res.status(400).json({ success:false, message:"orderId & amountRands required" });
  }

  const fields = {
    SiteCode: process.env.OZOW_SITE_CODE,
    CountryCode: process.env.OZOW_COUNTRY_CODE || "ZA",
    CurrencyCode: process.env.OZOW_CURRENCY_CODE || "ZAR",
    Amount: Number(amountRands).toFixed(2),          // "1.00"
    TransactionReference: String(orderId),           // unique per txn
    BankReference: (bankRef || String(orderId)).slice(-20), // ≤20 chars
    // Optionals available: Optional1..Optional5
    Customer: customer || "",
    CancelUrl: process.env.OZOW_CANCEL_URL,
    ErrorUrl: process.env.OZOW_ERROR_URL,
    SuccessUrl: process.env.OZOW_SUCCESS_URL,
    NotifyUrl: process.env.OZOW_NOTIFY_URL,
    IsTest: String(process.env.OZOW_IS_TEST === "true"),
  };

  const HashCheck = buildOzowRequestHash(fields, process.env.OZOW_PRIVATE_KEY);
  return res.json({ success:true, action: PAY_URL, method: "POST", fields: { ...fields, HashCheck }});
});

/** Ozow server-to-server notification */
router.post("/ozow/notify", express.urlencoded({ extended: false }), async (req, res) => {
  const { Hash, ...body } = req.body || {};
  const expected = buildOzowResponseHash(body, process.env.OZOW_PRIVATE_KEY);
  if ((Hash || "").toLowerCase() !== expected) {
    console.error("Ozow notify BAD HASH", { expected, got: Hash });
    return res.status(400).send("BAD HASH");
  }
  // TODO: update Mongo order by body.TransactionReference / body.Status ("Complete","Cancelled","Error")
  res.send("OK");
});

/** Optional: reconcile via Status API (header ApiKey) */
router.get("/ozow/status/by-ref/:reference", async (req, res) => {
  const url = `https://api.ozow.com/GetTransactionByReference?siteCode=${encodeURIComponent(process.env.OZOW_SITE_CODE)}&transactionReference=${encodeURIComponent(req.params.reference)}`;
  const r = await fetch(url, { headers: { "ApiKey": process.env.OZOW_API_KEY, "Accept":"application/json" }});
  const data = await r.json().catch(() => ({}));
  res.json({ success: r.ok, data });
});

export default router;
```

Mount it in your server:

```js
// app.js / server.js
import cors from "cors";
import ozowRoutes from "./routes/ozow.js";

app.use(cors({
  origin: ["https://capsaicin-frontend.vercel.app"], credentials: true,
  methods: ["GET","POST"], allowedHeaders: ["Content-Type","Authorization"]
}));
app.use(ozowRoutes);
```

> Ozow’s integration overview recommends a **Status API** call with `ApiKey` to ensure final state (prevents spoofed redirects). Hosted form posts to **pay.ozow\.com**. ([ozow.com][1])

---

# 4) Frontend (Next.js) — auto-submit form

```tsx
// app/checkout/OzowStart.tsx
"use client";
import { useState } from "react";

export default function OzowStart({ orderId, amountRands, bankRef, customer }:{
  orderId:string; amountRands:number; bankRef?:string; customer?:string;
}) {
  const [f, setF] = useState<{action:string; method:"POST"; fields:Record<string,string>}|null>(null);

  async function begin() {
    const r = await fetch("https://capsaicin-backend.onrender.com/ozow/initiate", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ orderId, amountRands, bankRef, customer })
    });
    const json = await r.json();
    if (!json?.success) return alert(json?.message || "Ozow init failed");
    setF(json);
    setTimeout(() => (document.getElementById("ozowForm") as HTMLFormElement)?.submit(), 0);
  }

  return (
    <>
      {!f && <button onClick={begin} className="px-4 py-2 rounded bg-black text-white">Pay with Ozow</button>}
      {f && (
        <form id="ozowForm" action={f.action} method={f.method} style={{display:"none"}}>
          {Object.entries(f.fields).map(([k,v]) => (
            <input key={k} type="hidden" name={k} value={String(v)} />
          ))}
          <noscript><button type="submit">Continue to Ozow</button></noscript>
        </form>
      )}
    </>
  );
}
```

Use it on `/checkout`:

```tsx
// app/checkout/page.tsx (excerpt)
import OzowStart from "./OzowStart";

export default function CheckoutPage() {
  const orderId = `INV-${Math.floor(Math.random()*1_000_000)}`;
  const amountRands = 1; // R1.00 test
  return <OzowStart orderId={orderId} amountRands={amountRands} customer="buyer@example.com" />;
}
```

Create simple pages at:

* `/payment/success`, `/payment/cancel`, `/payment/error`.
  On success, you can optionally call `GET /ozow/status/by-ref/:ref` (with the same `TransactionReference`) to show confirmed state — Ozow recommends this for resilience. ([ozow.com][1])

---

# 5) QA in 6 checks

1. **SiteCode** present and env loaded on Render.
2. **Request payload** from `/ozow/initiate` includes `HashCheck`.
3. Form posts to **`https://pay.ozow.com`** and shows Ozow hosted page. ([pay.ozow.com][2])
4. After payment, Ozow **redirects** to your Success/Cancel/Error and **POSTs** to your `NotifyUrl`.
5. Your `/ozow/notify` verifies `Hash` using the same algorithm (exclude `Hash` from concat).
6. Optional: `/ozow/status/by-ref/:reference` returns JSON when called with `ApiKey` header. ([ozow.com][1])

---

# 6) Gotchas (so you don’t burn hours)

* **HashCheck**: Build it **server-side** only. Concatenate *exactly the fields you post* in the order above, append **Private Key**, **lowercase**, **SHA-512**. (Same rule for response hash validation, excluding `Hash`.) ([ozow.com][1])
* **Amount**: `"1.00"` format (two decimals).
* **BankReference**: ≤ **20 chars**; keep it readable (`INV12345`).
* **CORS**: allow origin `https://capsaicin-frontend.vercel.app` on the backend.
* **Rotate keys** after you confirm prod works (they were shared in chat).

---

If you want, I can also generate a **playbook** JSON with example request/response bodies you can paste into Thunder Client/Postman to simulate the full flow.

[1]: https://ozow.com/integrations?utm_source=chatgpt.com "Payment Gateway Integration | Fast & Secure Solutions"
[2]: https://pay.ozow.com/?utm_source=chatgpt.com "Ozow Secure EFT Payments by Bank"

Name:
CAPE FAMILY CHEM (PTY)LTD
Merchant Code:
CAPEFAMILYCHEMPTYLTDC9ACF073A8
Default Bank Account:
Cape Family Chem (ABSA - 4105363103)
Time Zone:
(UTC+02:00) South Africa Standard Time (Johannesburg)
Private Key
5590125b084a4ff1bc8d3aa56f40986f 
API Key
976a9566da0647b5ac110fdac875a0a3 
Payouts API Key:
Default Password:
Company Registration Number:
K2022/637641/07
FIC Number:
FSCA Number:
Forex and Remittance license (AD) number:
Gambling License Number :

