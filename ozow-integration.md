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
