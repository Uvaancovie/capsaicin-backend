const express = require('express');
const router = express.Router();
const { buildOzowHash, verifyOzowHash } = require('../lib/ozowHash');
const fetch = global.fetch || require('node-fetch');

// POST /ozow/initiate
// body: { orderId, amountRands, bankRef, customer }
router.post('/ozow/initiate', express.json(), async (req, res) => {
  try {
    const { orderId, amountRands, bankRef, customer } = req.body || {};
    if (!orderId || !amountRands) return res.status(400).json({ success: false, message: 'orderId & amountRands required' });

    const amount = Number(amountRands).toFixed(2); // 2 decimal string
    const fields = {
      SiteCode: process.env.OZOW_SITE_CODE,
      CountryCode: process.env.OZOW_COUNTRY_CODE || 'ZA',
      CurrencyCode: process.env.OZOW_CURRENCY_CODE || 'ZAR',
      Amount: amount,
      TransactionReference: String(orderId),
      BankReference: String(bankRef || orderId).slice(0, 20),
      Optional1: '', Optional2: '', Optional3: '', Optional4: '', Optional5: '',
      Customer: customer || '',
      CancelUrl: process.env.OZOW_CANCEL_URL,
      ErrorUrl: process.env.OZOW_ERROR_URL,
      SuccessUrl: process.env.OZOW_SUCCESS_URL,
      NotifyUrl: process.env.OZOW_NOTIFY_URL,
      IsTest: (process.env.OZOW_IS_TEST || 'false').toString()
    };

    const privateKey = process.env.OZOW_PRIVATE_KEY || '';
      // Log canonical source used to compute HashCheck for debugging
      const srcForLog = [
        'SiteCode','CountryCode','CurrencyCode','Amount','TransactionReference','BankReference',
        'Optional1','Optional2','Optional3','Optional4','Optional5','Customer',
        'CancelUrl','ErrorUrl','SuccessUrl','NotifyUrl','IsTest'
      ].filter(k => Object.prototype.hasOwnProperty.call(fields, k)).map(k => String(fields[k] ?? '')).join('') + privateKey;
      console.log('Ozow concat src (lowercased):', String(srcForLog).toLowerCase());
      fields.HashCheck = buildOzowHash(fields, privateKey);
      console.log('Ozow HashCheck:', fields.HashCheck);

    // Return the action and fields to the client so they can auto-submit to https://pay.ozow.com
    return res.json({ action: 'https://pay.ozow.com', method: 'POST', fields });
  } catch (e) {
    console.error('Error in /ozow/initiate:', e && e.message);
    res.status(500).json({ success: false, message: e && e.message });
  }
});

// POST /ozow/notify - Ozow will POST back with transaction details and Hash
router.post('/ozow/notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const payload = req.body || {};
    const privateKey = process.env.OZOW_PRIVATE_KEY || '';
    const receivedHash = payload.Hash || payload.HashCheck || '';

    const ok = verifyOzowHash(payload, receivedHash, privateKey);
    if (!ok) {
      console.warn('Ozow notify hash mismatch', { payload, receivedHash });
      // still respond 200 to not keep Ozow retrying — but log for investigation
      res.set('Content-Type', 'text/plain');
      return res.status(200).send('OK');
    }

    // Example: update order in DB
    const transactionRef = payload.TransactionReference || payload.transactionReference;
    const status = payload.Status || payload.status || '';
    // TODO: update your Invoice model and mark as paid when appropriate
    console.log('Ozow notify verified', { transactionRef, status, payload });

    // Update Invoice in MongoDB if present
    try {
      const mongoose = require('mongoose');
      const Invoice = mongoose.models && (mongoose.models.Invoice || (mongoose.model && mongoose.model('Invoice')));
      if (Invoice && transactionRef) {
        const update = {
          $set: {
            transaction_status: status,
            paid_at: status && String(status).toLowerCase().includes('success') ? new Date() : undefined,
            status: status && String(status).toLowerCase().includes('success') ? 'completed' : undefined
          }
        };
        const result = await Invoice.updateOne({ invoice_number: transactionRef }, update);
        if (result && (result.matchedCount || result.nModified || result.modifiedCount)) {
          console.log('Invoice updated from Ozow notify for', transactionRef);
        } else {
          console.warn('Invoice update did not match any documents for', transactionRef, result);
        }
      } else {
        console.warn('Invoice model not available or missing transactionRef');
      }
    } catch (e) {
      console.warn('Invoice update skipped due to error:', e && e.message);
    }
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Error in /ozow/notify:', err && err.message);
    res.status(500).send('ERROR');
  }
});


// Forward endpoint - return auto-submitting HTML form to post to Ozow (debug helper)
router.get('/ozow/forward', (req, res) => {
  try {
    const ozowEndpoint = 'https://pay.ozow.com';
    const params = Object.assign({}, req.query);
    const inputs = Object.keys(params).map(k => {
      const v = String(params[k] || '').replace(/"/g, '&quot;');
      return `<input type="hidden" name="${k}" value="${v}"/>`;
    }).join('\n');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ozow Forward</title></head><body><form id="f" method="POST" action="${ozowEndpoint}">\n${inputs}\n</form><script>document.getElementById('f').submit();</script></body></html>`;
    res.set('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (e) {
    console.error('Error in /ozow/forward:', e && e.message);
    return res.status(500).send('ERROR');
  }
});

// Also accept POST forward with form fields
router.post('/ozow/forward', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const params = req.body || {};
    const ozowEndpoint = 'https://pay.ozow.com';
    const inputs = Object.keys(params).map(k => {
      const v = String(params[k] || '').replace(/"/g, '&quot;');
      return `<input type="hidden" name="${k}" value="${v}"/>`;
    }).join('\n');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ozow Forward</title></head><body><form id="f" method="POST" action="${ozowEndpoint}">\n${inputs}\n</form><script>document.getElementById('f').submit();</script></body></html>`;
    res.set('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (e) {
    console.error('Error in /ozow/forward POST:', e && e.message);
    return res.status(500).send('ERROR');
  }
});

// GET /ozow/status/by-ref/:ref - lookup via Ozow API
router.get('/ozow/status/by-ref/:ref', async (req, res) => {
  try {
    const ref = req.params.ref;
    if (!ref) return res.status(400).json({ success: false, message: 'ref required' });

    const apiKey = process.env.OZOW_API_KEY || '';
    const url = `https://api.ozow.com/Transaction/GetTransactionByReference?TransactionReference=${encodeURIComponent(ref)}`;
    const r = await fetch(url, { headers: { ApiKey: apiKey } });
    const json = await r.json();
    return res.json({ success: true, data: json });
  } catch (e) {
    console.error('Error in /ozow/status:', e && e.message);
    res.status(500).json({ success: false, message: e && e.message });
  }
});

module.exports = router;
