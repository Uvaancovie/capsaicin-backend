const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Helper for MD5 checksum used by PayWeb3
function md5Hex(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function payweb3Checksum(values = []) {
  // PayWeb3: concatenate values (no separators) then append the encryption key
  const key = process.env.PAYGATE_ENCRYPTION_KEY || '';
  return md5Hex(values.join('') + key);
}

// PayWeb3 initiate endpoint (server-to-server). Returns process URL and fields.
router.post('/paygate/initiate', express.json(), async (req, res) => {
  try {
    const { orderId, amountRands, email = '' } = req.body || {};
    if (!orderId || !amountRands) return res.status(400).json({ success: false, message: 'orderId & amountRands required' });

    const PAYGATE_ID = process.env.PAYGATE_ID || '';
    const RETURN_URL = process.env.PAYGATE_RETURN_URL || '';
    const NOTIFY_URL = process.env.PAYGATE_NOTIFY_URL || '';

    const basePayload = {
      PAYGATE_ID,
      REFERENCE: String(orderId),
      AMOUNT: String(Math.round(Number(amountRands) * 100)), // cents
      CURRENCY: 'ZAR',
      RETURN_URL,
      TRANSACTION_DATE: new Date().toISOString().slice(0, 19).replace('T', ' '),
      LOCALE: 'en-za',
      COUNTRY: 'ZAF',
      EMAIL: email || ''
    };

    const fetch = global.fetch || require('node-fetch');

    // Try a sequence of checksum variants to handle subtle MAP differences.
    const variants = [
      { name: 'with_notify', includeNotify: true, locale: 'en-za', country: 'ZAF' },
      { name: 'no_notify', includeNotify: false, locale: 'en-za', country: 'ZAF' },
      { name: 'locale_en_country_ZA', includeNotify: false, locale: 'en', country: 'ZA' },
      // Try excluding RETURN_URL from checksum (some MAPs differ)
      { name: 'no_return_in_checksum', includeNotify: true, locale: 'en-za', country: 'ZAF', excludeReturn: true },
      // Alternate transaction date formats
      { name: 'txndate_iso_t', includeNotify: true, locale: 'en-za', country: 'ZAF', txnDateIsoT: true },
      { name: 'txndate_secondsless', includeNotify: true, locale: 'en-za', country: 'ZAF', txnDateSecondsless: true }
    ];

    const attempts = [];
    let finalReply = null;

    for (const v of variants) {
      const payload = Object.assign({}, basePayload);
      payload.LOCALE = v.locale;
      payload.COUNTRY = v.country;
      if (v.includeNotify) payload.NOTIFY_URL = NOTIFY_URL || '';

      // prepare TRANSACTION_DATE formatting variants
      if (v.txnDateIsoT) {
        payload.TRANSACTION_DATE = new Date().toISOString().slice(0, 19);
      } else if (v.txnDateSecondsless) {
        payload.TRANSACTION_DATE = new Date().toISOString().slice(0, 16).replace('T', ' ');
      } else {
        payload.TRANSACTION_DATE = new Date().toISOString().slice(0, 19).replace('T', ' ');
      }

      payload.LOCALE = v.locale;
      payload.COUNTRY = v.country;
      if (v.includeNotify) payload.NOTIFY_URL = NOTIFY_URL || '';

      // Build checksum values in canonical order; allow excluding RETURN_URL if variant requests it.
      const checksumValues = [];
      checksumValues.push(payload.PAYGATE_ID);
      checksumValues.push(payload.REFERENCE);
      checksumValues.push(String(payload.AMOUNT));
      checksumValues.push(payload.CURRENCY);
      if (!v.excludeReturn) checksumValues.push(payload.RETURN_URL);
      checksumValues.push(payload.TRANSACTION_DATE);
      checksumValues.push(payload.LOCALE);
      checksumValues.push(payload.COUNTRY);
      checksumValues.push(payload.EMAIL);
      if (v.includeNotify) checksumValues.push(payload.NOTIFY_URL || '');

      const canonical = checksumValues.join('');
      payload.CHECKSUM = md5Hex(canonical + (process.env.PAYGATE_ENCRYPTION_KEY || ''));
      const body = new URLSearchParams(payload).toString();

      console.log('PayWeb3 initiate attempt', v.name, { payloadSummary: { REFERENCE: payload.REFERENCE, AMOUNT: payload.AMOUNT, TRANSACTION_DATE: payload.TRANSACTION_DATE, RETURN_URL: v.excludeReturn ? '[excluded]' : payload.RETURN_URL, NOTIFY_URL: v.includeNotify ? payload.NOTIFY_URL : '[excluded]' }, canonical, checksum: payload.CHECKSUM });

      try {
        const r = await fetch('https://secure.paygate.co.za/payweb3/initiate.trans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        });
        const text = await r.text();
        const reply = Object.fromEntries(new URLSearchParams(text));
  attempts.push({ variant: v.name, status: r.status, reply, bodySent: body, canonical });

        // If PayGate returns an obvious error, try next variant
        if (reply && reply.CHECKSUM) {
          const expect = payweb3Checksum([reply.PAYGATE_ID || '', reply.PAY_REQUEST_ID || '', reply.REFERENCE || '']);
          if (expect === reply.CHECKSUM) {
            finalReply = reply;
            console.log('PayWeb3 initiate successful with variant', v.name, { reply });
            break;
          } else {
            console.warn('Reply checksum mismatch for variant', v.name, { expect, got: reply.CHECKSUM });
            // continue to next variant
          }
        } else {
          // No CHECKSUM in reply (likely ERROR), log and continue
          console.warn('PayGate reply missing CHECKSUM for variant', v.name, reply || text);
        }
      } catch (err) {
        console.error('Error posting to PayGate initiate for variant', v.name, err && err.message);
        attempts.push({ variant: v.name, error: err && err.message });
      }
    }

    if (!finalReply) {
      const last = attempts.length ? attempts[attempts.length - 1] : null;
      console.error('All PayWeb3 initiate attempts failed', { attempts });
      return res.status(400).json({ success: false, message: 'Checksum mismatch from PayGate or DATA_CHK', attempts });
    }

    return res.json({ success: true, processUrl: 'https://secure.paygate.co.za/payweb3/process.trans', fields: { PAY_REQUEST_ID: finalReply.PAY_REQUEST_ID, CHECKSUM: finalReply.CHECKSUM }, debug: { attempts } });
  } catch (e) {
    console.error('Error in /paygate/initiate:', e && e.message);
    return res.status(500).json({ success: false, message: e && e.message });
  }
});

// Health endpoint
router.get('/paygate/health', (req, res) => {
  res.json({ success: true, message: 'PayGate route healthy' });
});

// Return endpoint (user-facing)
router.get('/paygate/return', (req, res) => {
  // PayGate will redirect users here after payment
  res.json({ success: true, message: 'Payment return received', query: req.query });
});

// Notify endpoint (server-to-server from PayGate)
router.post('/paygate/notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('PayGate notify received:', payload);

    // Example expected fields: TRANSACTION_STATUS, ORDER_ID, AMOUNT
    const status = payload.TRANSACTION_STATUS;
    const orderId = payload.ORDER_ID || payload.order_id || payload.ORDER_NUMBER;
    const amount = payload.AMOUNT || payload.amount;

    // TODO: wire this to your DB - update the order as PAID when TRANSACTION_STATUS === '1'
    if (status === '1') {
      console.log(`Order ${orderId} marked as PAID (amount: ${amount})`);
      // Update the Invoice model that is defined in server.js
      try {
        // mongoose connection & models are registered in server.js, so reuse them
        const mongoose = require('mongoose');
        const Invoice = mongoose.models && (mongoose.models.Invoice || (mongoose.model && mongoose.model('Invoice')));
        if (Invoice && orderId) {
          const update = {
            $set: {
              status: 'completed',
              paid_at: new Date(),
              transaction_status: status,
              transaction_amount: Number(amount) || undefined
            }
          };

          const result = await Invoice.updateOne({ invoice_number: orderId }, update);
          if (result && (result.matchedCount || result.nModified || result.modifiedCount)) {
            console.log('Invoice updated to completed for', orderId);
          } else {
            console.warn('Invoice update did not match any documents for', orderId, result);
          }
        } else {
          console.warn('Invoice model not available or missing orderId');
        }
      } catch (e) {
        console.warn('Invoice update skipped due to error:', e.message);
      }
    }

    // Respond quickly with OK to acknowledge the notify
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Error in paygate notify:', err);
    res.status(500).send('ERROR');
  }
});


// Create endpoint - server signs payload for PayGate
router.post('/paygate/create', express.json(), async (req, res) => {
  try {
    console.log('Incoming /paygate/create request headers:', {
      origin: req.headers.origin,
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    })
    console.log('Incoming /paygate/create body:', req.body)
    const { orderId, amountRands, currency = 'ZAR', description = '' } = req.body || {};

    if (!orderId || !amountRands) {
      return res.status(400).json({ success: false, message: 'orderId and amountRands are required' });
    }

    const paygateId = process.env.PAYGATE_ID || process.env.PAYGATE_ID || '';
    const encryptionKey = process.env.PAYGATE_ENCRYPTION_KEY || process.env.PAYGATE_ENCRYPTION_KEY || '';
    const returnUrl = process.env.PAYGATE_RETURN_URL || '';
    const notifyUrl = process.env.PAYGATE_NOTIFY_URL || '';

    // Prepare parameters expected by PayGate (example names - adjust to your MAP config)
    const params = {
      PAYGATE_ID: paygateId,
      REFERENCE: orderId,
      AMOUNT: Math.round(Number(amountRands) * 100).toString(), // cents
      CURRENCY: currency,
      RETURN_URL: returnUrl,
      NOTIFY_URL: notifyUrl,
      DESCRIPTION: description,
      TIMESTAMP: Date.now().toString()
    };

    // Build canonical string (sorted keys)
    const keys = Object.keys(params).sort();
    const canonical = keys.map(k => `${k}=${params[k]}`).join('&');

    // Signature method - support HMAC-SHA256 (default) or MD5(canonical+key)
    const sigMethod = (process.env.PAYGATE_SIGNATURE_TYPE || 'hmac-sha256').toLowerCase();
    let signature = '';
    if (sigMethod === 'md5') {
      const md5 = crypto.createHash('md5');
      md5.update(canonical + (encryptionKey || ''));
      signature = md5.digest('hex');
    } else {
      const hmac = crypto.createHmac('sha256', encryptionKey || '');
      hmac.update(canonical);
      signature = hmac.digest('hex');
    }

    // Return fields for the client to POST to PayGate
    return res.json({
      success: true,
      endpoint: 'https://secure.paygate.co.za/paypage',
      fields: params,
      signature,
      signature_method: 'HMAC-SHA256'
    });
  } catch (err) {
    console.error('Error in /paygate/create:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


  // Forward endpoint - avoid CORS by navigating to this backend URL which returns an auto-submitting form
  router.get('/paygate/forward', (req, res) => {
    try {
      // Accept fields via query params for quick debugging (not secure for production)
      const paygateEndpoint = (req.query.endpoint || 'https://secure.paygate.co.za/paypage');
      const params = Object.assign({}, req.query);
      // Build form inputs
      const inputs = Object.keys(params).filter(k => k !== 'endpoint').map(k => {
        const v = String(params[k] || '').replace(/"/g, '&quot;');
        return `<input type="hidden" name="${k}" value="${v}"/>`;
      }).join('\n');

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>PayGate Forward</title></head><body><form id="f" method="POST" action="${paygateEndpoint}">\n${inputs}\n</form><script>document.getElementById('f').submit();</script></body></html>`;
      res.set('Content-Type', 'text/html');
      return res.status(200).send(html);
    } catch (e) {
      console.error('Error in /paygate/forward:', e && e.message);
      return res.status(500).send('ERROR');
    }
  });

  // Optional POST forward that returns auto-submitting HTML (accepts JSON body or form)
  router.post('/paygate/forward', express.urlencoded({ extended: true }), async (req, res) => {
    try {
      const params = req.body || {};
      const paygateEndpoint = params.endpoint || 'https://secure.paygate.co.za/paypage';
      const inputs = Object.keys(params).filter(k => k !== 'endpoint').map(k => {
        const v = String(params[k] || '').replace(/"/g, '&quot;');
        return `<input type="hidden" name="${k}" value="${v}"/>`;
      }).join('\n');

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>PayGate Forward</title></head><body><form id="f" method="POST" action="${paygateEndpoint}">\n${inputs}\n</form><script>document.getElementById('f').submit();</script></body></html>`;
      res.set('Content-Type', 'text/html');
      return res.status(200).send(html);
    } catch (e) {
      console.error('Error in /paygate/forward POST:', e && e.message);
      return res.status(500).send('ERROR');
    }
  });

// Proxy endpoint - server-side POST to PayGate for debugging (returns status, headers and body)
router.post('/paygate/proxy', express.json(), async (req, res) => {
  try {
    const params = req.body && req.body.fields ? req.body.fields : (req.body || {});
    const endpoint = req.body && req.body.endpoint ? req.body.endpoint : 'https://secure.paygate.co.za/paypage';

    // Build form-encoded body
    const formEntries = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k] || ''))).join('&');

    // Use native https/https request to avoid extra deps
    const url = require('url');
    const parsed = url.parse(endpoint);
    const https = parsed.protocol === 'https:' ? require('https') : require('http');

    const requestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.path || parsed.pathname || '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formEntries),
        // set a sensible User-Agent
        'User-Agent': req.headers['user-agent'] || 'Capsaicin-Server/1.0'
      }
    };

    // Perform request
    const proxyResp = await new Promise((resolve, reject) => {
      const r = https.request(requestOptions, (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: resp.statusCode, headers: resp.headers, body });
        });
      });
      r.on('error', (err) => reject(err));
      r.write(formEntries);
      r.end();
    });

    // Return proxied response for debugging
    return res.status(200).json({ ok: true, proxied: proxyResp });
  } catch (e) {
    console.error('Error in /paygate/proxy:', e && e.message);
    return res.status(500).json({ ok: false, message: e && e.message });
  }
});

module.exports = router;

// NOTE: the file previously exported router above; append forwarding helpers below
