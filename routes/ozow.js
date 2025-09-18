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
    // Normalize and validate URLs from env to avoid malformed values like "://..."
    const normalizeUrl = (u) => {
      if (!u) return u;
      try {
        let s = String(u).trim();
        // If it already explicitly declares a scheme like 'http:', 'https:', 'mailto:', etc., return as-is
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;

        // Remove any leading http(s)://, //, or :// so we don't accidentally create 'https://://...'
        // Examples handled: 'https://example', '//example', '://example', 'http://example'
        s = s.replace(/^(https?:)?:\/\//i, ''); // remove leading http(s):// or ://
        s = s.replace(/^\/\//, ''); // remove leading // if any left
        // Remove leading colons or slashes left-over
        s = s.replace(/^[:\/]+/, '');

        // Finally ensure it has https://
        return `https://${s}`;
      } catch (e) {
        return u;
      }
    };

    const cancelUrlRaw = process.env.OZOW_CANCEL_URL || '';
    const errorUrlRaw = process.env.OZOW_ERROR_URL || '';
    const successUrlRaw = process.env.OZOW_SUCCESS_URL || '';
    const notifyUrlRaw = process.env.OZOW_NOTIFY_URL || '';

    const CancelUrl = normalizeUrl(cancelUrlRaw);
    const ErrorUrl = normalizeUrl(errorUrlRaw);
    const SuccessUrl = normalizeUrl(successUrlRaw);
    const NotifyUrl = normalizeUrl(notifyUrlRaw);

    // If normalization changed anything, log a helpful warning so env can be corrected
    if (CancelUrl !== cancelUrlRaw || ErrorUrl !== errorUrlRaw || SuccessUrl !== successUrlRaw || NotifyUrl !== notifyUrlRaw) {
      console.warn('One or more OZOW URL env values were normalized. Please update your environment to include full URLs (including https://).');
      console.warn({ cancelUrlRaw, errorUrlRaw, successUrlRaw, notifyUrlRaw, CancelUrl, ErrorUrl, SuccessUrl, NotifyUrl });
    }

    const fields = {
      SiteCode: process.env.OZOW_SITE_CODE,
      CountryCode: process.env.OZOW_COUNTRY_CODE || 'ZA',
      CurrencyCode: process.env.OZOW_CURRENCY_CODE || 'ZAR',
      Amount: amount,
      TransactionReference: String(orderId),
      BankReference: String(bankRef || orderId).slice(0, 20),
      Optional1: '', Optional2: '', Optional3: '', Optional4: '', Optional5: '',
      Customer: customer || '',
      CancelUrl,
      ErrorUrl,
      SuccessUrl,
      NotifyUrl,
      IsTest: (process.env.OZOW_IS_TEST || 'false').toString()
    };

    // Final sanitization: collapse accidental duplicate schemes like 'https://://example'
    const sanitizeOutgoingUrl = (u) => {
      if (!u) return u;
      try {
        let s = String(u);
        // Replace occurrences like 'https://://' or 'https:////' with a single 'https://'
        s = s.replace(/https?:\/\/:\/\//i, 'https://');
        s = s.replace(/https?:\/\//i, (m) => m.toLowerCase());
        // Collapse repeated sequences of '://'
        s = s.replace(/:\/\/:\/\//g, '://');
        // If somehow we still have 'https://://', collapse
        s = s.replace(/https?:\/\:\/\//i, 'https://');
        // Remove stray duplicate protocols like 'https://https://' -> 'https://'
        s = s.replace(/^(https?:\/\/)+/i, 'https://');
        return s;
      } catch (e) {
        return u;
      }
    };

    fields.CancelUrl = sanitizeOutgoingUrl(fields.CancelUrl);
    fields.ErrorUrl = sanitizeOutgoingUrl(fields.ErrorUrl);
    fields.SuccessUrl = sanitizeOutgoingUrl(fields.SuccessUrl);
    fields.NotifyUrl = sanitizeOutgoingUrl(fields.NotifyUrl);

    const privateKey = process.env.OZOW_PRIVATE_KEY || '';
      // Log the fields we will send (safe: doesn't include private key)
      try {
        console.log('Ozow fields (no private key):', JSON.stringify(fields));
      } catch (e) {}
      // Log short hints (safe) to help verify environment values without printing secrets
      try {
        console.log('OZOW_SITE_CODE:', String(process.env.OZOW_SITE_CODE || ''));
        const pk = String(privateKey || '');
        console.log('OZOW_PRIVATE_KEY hint:', pk ? `${pk.slice(0,4)}...${pk.slice(-4)}` : '(none)');
      } catch (e) {}
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
      // Persist webhook failure for investigation and retry
      try {
        const mongoose = require('mongoose');
        const WebhookFailure = mongoose.models && (mongoose.models.WebhookFailure || (mongoose.model && mongoose.model('WebhookFailure')));
        if (WebhookFailure) {
          await WebhookFailure.create({ provider: 'ozow', payload, reason: 'hash_mismatch', retries: 0 });
          console.log('Logged webhook failure for hash mismatch');
        }
      } catch (e) {
        console.warn('Failed to log webhook failure', e && e.message);
      }
      // respond 200 so Ozow does not keep retrying on our transient issues
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
          // log webhook failure for missing invoice
          try {
            const WebhookFailure = mongoose.models && (mongoose.models.WebhookFailure || (mongoose.model && mongoose.model('WebhookFailure')));
            if (WebhookFailure) {
              await WebhookFailure.create({ provider: 'ozow', payload, reason: 'invoice_not_found', retries: 0 });
              console.log('Logged webhook failure for missing invoice');
            }
          } catch (e) {
            console.warn('Failed to log webhook failure for missing invoice', e && e.message);
          }
        }
      } else {
        console.warn('Invoice model not available or missing transactionRef');
        try {
          const mongoose = require('mongoose');
          const WebhookFailure = mongoose.models && (mongoose.models.WebhookFailure || (mongoose.model && mongoose.model('WebhookFailure')));
          if (WebhookFailure) {
            await WebhookFailure.create({ provider: 'ozow', payload, reason: 'invoice_model_unavailable', retries: 0 });
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn('Invoice update skipped due to error:', e && e.message);
      try {
        const mongoose = require('mongoose');
        const WebhookFailure = mongoose.models && (mongoose.models.WebhookFailure || (mongoose.model && mongoose.model('WebhookFailure')));
        if (WebhookFailure) {
          await WebhookFailure.create({ provider: 'ozow', payload, reason: `update_error:${e && e.message ? String(e.message).slice(0,200) : 'unknown'}`, retries: 0 });
        }
      } catch (ie) {}
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
