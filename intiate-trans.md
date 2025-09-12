mr covie — here’s a paste-ready **CONTEXT\_FIX\_PAYGATE\_INITIATE.md** that explains the cause and gives exact patches to kill the 400 “Checksum mismatch / missing CHECKSUM” and stop the old PayPage flow from leaking into prod.

---

# CONTEXT\_FIX\_PAYGATE\_INITIATE.md

**Project:** Capsaicin (Next.js + Express/Mongo)
**Gateway:** DPO **PayGate – PayWeb v3 (PayWeb3)**
**Current errors:**

* `POST /paygate/initiate → 400 (Bad Request)`
* `Checksum mismatch from PayGate reply { expect: '…', got: undefined }`
* Browser still shows payloads for `https://secure.paygate.co.za/paypage` with `HMAC-SHA256`

## Root cause (summary)

1. **Wrong product endpoint leaked** (PayPage): some code still posts to **`/paypage`** and signs with **HMAC-SHA256**. Your account is PayWeb3 (uses **`initiate.trans → process.trans`** and **MD5**).
2. **PayWeb3 request checksum invalid**: PayGate answered with an **error payload** (no `CHECKSUM` field), which your code tried to verify—hence “got: undefined”.

> Fix = remove PayPage completely, align **MD5 request fields+order**, and ensure the **Encryption Key** in MAP = the one in your server env.

---

## 1) Environment (update now)

**.env (development)**

```ini
PORT=4000
MONGODB_URI='mongodb+srv://way2flyagency:way2flymillionaire@mern.7txgf4m.mongodb.net/capsaicin-ecommerce'
JWT_SECRET='changeme'
NODE_ENV=development

# PayGate PayWeb3 (LIVE)
PAYGATE_ID=1051358100016
PAYGATE_ENCRYPTION_KEY=6VfipYPvWcP4        # 1–32 alphanumeric; MUST MATCH MAP
PAYGATE_RETURN_URL=http://localhost:3001/paygate/return
PAYGATE_NOTIFY_URL=http://localhost:4000/paygate/notify

# ❌ REMOVE these if present (they belong to PayPage, not PayWeb3)
# PAYGATE_SIGNATURE_TYPE=hmac-sha256

VAT_NUMBER=4020314623
```

**.env (production)**

```ini
PAYGATE_RETURN_URL=https://capsaicin-frontend.vercel.app/paygate/return
PAYGATE_NOTIFY_URL=https://capsaicin-backend.onrender.com/paygate/notify
```

> Note: PayGate won’t call `localhost` for NOTIFY in real traffic. For full ITN tests, use Render/Vercel URLs or an ngrok tunnel.

---

## 2) MAP (PayGate portal) — verify once

* **Product:** PayWeb v3 Configure
* **Encryption Key:** `6VfipYPvWcP4`  ← make this exactly the same as your env
* **Default Return URL:** `https://capsaicin-frontend.vercel.app/paygate/return`
* **Default Notify URL:** `https://capsaicin-backend.onrender.com/paygate/notify`
* **Display VAT:** `4020314623`

---

## 3) Remove PayPage everywhere (search & destroy)

Search the repo (frontend + backend) for:

* `paypage`
* `signature_method`
* `HMAC` / `hmac-sha256`

Delete/disable any code that returns a payload like:

```json
{ "endpoint": "https://secure.paygate.co.za/paypage", "signature_method": "HMAC-SHA256", ... }
```

Only PayWeb3 is supported on your profile.

---

## 4) Backend patch — robust PayWeb3 **initiate** (MD5)

**File:** `routes/paygate.js` (replace your initiate handler with this)

```js
import express from "express";
import crypto from "crypto";

const router = express.Router();

const {
  PAYGATE_ID,
  PAYGATE_ENCRYPTION_KEY,
  PAYGATE_RETURN_URL,
  PAYGATE_NOTIFY_URL,
} = process.env;

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// PayWeb3 request checksum: 9 fields (IN ORDER) + key — DO NOT include NOTIFY_URL in the checksum
const reqChecksum = (p) => md5(
  p.PAYGATE_ID +
  p.REFERENCE +
  String(p.AMOUNT) +
  p.CURRENCY +
  p.RETURN_URL +
  p.TRANSACTION_DATE +
  p.LOCALE +
  p.COUNTRY +
  p.EMAIL +
  PAYGATE_ENCRYPTION_KEY
);

// PayWeb3 response checksum: PAYGATE_ID + PAY_REQUEST_ID + REFERENCE + key
const respChecksum = (p) => md5(
  p.PAYGATE_ID + p.PAY_REQUEST_ID + p.REFERENCE + PAYGATE_ENCRYPTION_KEY
);

// tolerant KV parser (handles querystring or newline-delimited)
function parseKv(text) {
  const t = (text || "").trim();
  if (!t) return {};
  if (t.includes("&")) return Object.fromEntries(new URLSearchParams(t));
  const out = {};
  t.split(/\r?\n/).forEach(line => {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  });
  return out;
}

router.post("/paygate/initiate", express.json(), async (req, res) => {
  try {
    const { orderId, amountRands, email = "buyer@example.com" } = req.body || {};
    if (!orderId || !amountRands) {
      return res.status(400).json({ success: false, message: "orderId & amountRands required" });
    }

    const payload = {
      PAYGATE_ID,
      REFERENCE: String(orderId),
      AMOUNT: Math.round(Number(amountRands) * 100), // cents
      CURRENCY: "ZAR",
      RETURN_URL: PAYGATE_RETURN_URL,
      TRANSACTION_DATE: new Date().toISOString().slice(0,19).replace("T"," "),
      LOCALE: "en-za",
      COUNTRY: "ZAF",
      EMAIL: email || "buyer@example.com",
      NOTIFY_URL: PAYGATE_NOTIFY_URL, // send it, but exclude from checksum
    };

    const CHECKSUM = reqChecksum(payload);
    const body = new URLSearchParams({ ...payload, CHECKSUM }).toString();

    const r = await fetch("https://secure.paygate.co.za/payweb3/initiate.trans", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const text = await r.text();

    // If HTTP failed or we got HTML, bubble up (prevents undefined CHECKSUM issues)
    if (!r.ok || /^</.test(text)) {
      return res.status(502).json({
        success: false,
        message: "INITIATE_HTTP_ERROR",
        status: r.status,
        bodyPreview: text.slice(0, 400)
      });
    }

    const reply = parseKv(text);

    // PayGate error → no CHECKSUM present; surface it
    if (reply.ERROR) {
      return res.status(400).json({ success: false, message: reply.ERROR, reply });
    }

    // Guard: ensure required reply fields
    if (!reply.PAYGATE_ID || !reply.PAY_REQUEST_ID || !reply.REFERENCE || !reply.CHECKSUM) {
      return res.status(400).json({
        success: false,
        message: "INITIATE_MISSING_FIELDS",
        replyRaw: text,
        replyParsed: reply
      });
    }

    // Verify response checksum
    const expect = respChecksum(reply);
    if ((reply.CHECKSUM || "").toLowerCase() !== expect) {
      return res.status(400).json({
        success: false,
        message: "INITIATE_BAD_RESPONSE_CHECKSUM",
        expect,
        got: reply.CHECKSUM,
        reply
      });
    }

    return res.json({
      success: true,
      processUrl: "https://secure.paygate.co.za/payweb3/process.trans",
      fields: {
        PAY_REQUEST_ID: reply.PAY_REQUEST_ID,
        CHECKSUM: reply.CHECKSUM
      }
    });
  } catch (e) {
    console.error("initiate error:", e);
    return res.status(500).json({ success: false, message: "INITIATE_FAILED" });
  }
});

// Notify + Return handlers unchanged (from prior PR)
// Ensure /paygate/notify responds plain "OK" after validating MD5 checksum.
export default router;
```

**Mount once in server:**

```js
import paygateRoutes from "./routes/paygate.js";
app.use(paygateRoutes);
```

---

## 5) Frontend – keep only PayWeb3 flow

**Your checkout button must:**

1. `POST https://capsaicin-backend.onrender.com/paygate/initiate`
2. On success, auto-POST to `https://secure.paygate.co.za/payweb3/process.trans` with **only**:

   * `PAY_REQUEST_ID`
   * `CHECKSUM`

**Hidden form pattern (client component):**

```tsx
"use client";
import { useState } from "react";

export default function PayGateButton({ orderId, amountRands }:{
  orderId: string; amountRands: number;
}) {
  const [form, setForm] = useState<{processUrl?: string; fields?: Record<string,string>}>({});

  const start = async () => {
    const r = await fetch("https://capsaicin-backend.onrender.com/paygate/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      {form.processUrl && (
        <form id="pg-form" method="POST" action={form.processUrl} style={{ display: "none" }}>
          {Object.entries(form.fields!).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <noscript><button type="submit">Continue</button></noscript>
        </form>
      )}
    </>
  );
}
```

**Return router:**
Create `app/paygate/return/page.tsx` that routes users based on `TRANSACTION_STATUS` to your existing `/payment/success` or `/payment/cancel`.

---

## 6) Health checks & CORS

**Health route (optional):**

```js
app.get("/paygate/health", (_req, res) => {
  const sample = [process.env.PAYGATE_ID,"order_HEALTH","100","ZAR","https://x","2025-09-12 12:00:00","en-za","ZAF","buyer@example.com"].join("") + process.env.PAYGATE_ENCRYPTION_KEY;
  const sampleChecksum = crypto.createHash("md5").update(sample).digest("hex");
  res.json({ keyLoaded: !!process.env.PAYGATE_ENCRYPTION_KEY, sampleChecksum });
});
```

**CORS (if your dev origin differs):**

```js
import cors from "cors";
app.use(cors({
  origin: ["https://capsaicin-frontend.vercel.app","http://localhost:3001"],
  methods: ["GET","POST"],
  credentials: true
}));
```

---

## 7) Test protocol

### A) Prod-domain E2E (recommended)

1. Deploy backend with env set (Render).
2. From `https://capsaicin-frontend.vercel.app/checkout` click **Proceed to Payment**.
3. Expect JSON:

   ```json
   { "success": true, "processUrl": ".../payweb3/process.trans",
     "fields": { "PAY_REQUEST_ID":"...", "CHECKSUM":"..." } }
   ```
4. Hosted page loads; complete card payment (3-D Secure).
5. Render logs show `/paygate/notify` and your handler responds **OK**.
6. Mark order **PAID** only when `TRANSACTION_STATUS="1"` and amount (cents) matches.

### B) Dev-domain quick check (no notify)

* Return to `http://localhost:3001/paygate/return` works; **notify won’t** fire to `localhost:4000` unless you tunnel (ngrok) and set that URL in MAP + env.

---

## 8) Troubleshooting (fast)

* **`ERROR=DATA_CHK`** from initiate
  → Request checksum wrong: make sure you used **exactly** the 9 fields (no NOTIFY\_URL), order intact, amount in cents, key correct in MAP & env.

* **`INITIATE_MISSING_FIELDS` / `got: undefined`**
  → PayGate sent an **error** or **HTML** (CDN). The handler now surfaces `replyRaw`/`bodyPreview`. Read it; fix the cause (usually key mismatch).

* **Still seeing `/paypage`** in console
  → You still have legacy code path. Search repo for `paypage` & `HMAC` and delete.

* **Amount issues**
  → R1.00 must be `"100"` in the server payload.

---

## 9) VAT on receipts

* MAP “Display VAT”: `4020314623`.
* Also print `VAT No: 4020314623` on your own success/invoice pages and compute VAT @ 15% for customer docs.

---

### Final checklist

* [ ] MAP key = env key = `6VfipYPvWcP4`
* [ ] Initiate MD5 uses **9 fields**, correct order, **no NOTIFY\_URL** in checksum
* [ ] Frontend posts **only** `PAY_REQUEST_ID` + `CHECKSUM` to `…/payweb3/process.trans`
* [ ] Notify returns **plain `OK`** (after verifying MD5 + amount)
* [ ] No `paypage` / `HMAC` left in code

Ship this and your **Proceed to Payment** will stop 400’ing and route cleanly through the PayWeb3 hosted page.
