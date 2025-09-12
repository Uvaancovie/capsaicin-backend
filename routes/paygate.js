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

const { buildInitiateChecksum, buildInitiateReplyChecksum } = require('../lib/paygateChecksum');

// PayWeb3 initiate endpoint (server-to-server). Returns process URL and fields.
router.post('/paygate/initiate', express.json(), async (req, res) => {
  try {
    const { orderId, amountRands, email = '' } = req.body || {};
    if (!orderId || !amountRands) return res.status(400).json({ success: false, message: 'orderId & amountRands required' });

    const f = {
      PAYGATE_ID: process.env.PAYGATE_ID,
      REFERENCE: String(orderId),
      AMOUNT: String(Math.round(Number(amountRands) * 100)), // cents, as string
      CURRENCY: 'ZAR',
      RETURN_URL: process.env.PAYGATE_RETURN_URL,
      TRANSACTION_DATE: new Date().toISOString().slice(0, 19).replace('T', ' '), // "YYYY-MM-DD HH:mm:ss"
      LOCALE: 'en-za',
      COUNTRY: 'ZAF',
      EMAIL: email || '',
      NOTIFY_URL: process.env.PAYGATE_NOTIFY_URL
    };

    f.CHECKSUM = buildInitiateChecksum(f, process.env.PAYGATE_ENCRYPTION_KEY);
    const body = new URLSearchParams(f).toString();

    // Log the exact source you hash
    const srcForLog = [
      f.PAYGATE_ID, f.REFERENCE, f.AMOUNT, f.CURRENCY, f.RETURN_URL,
      f.TRANSACTION_DATE, f.LOCALE, f.COUNTRY, f.EMAIL, f.NOTIFY_URL
    ].join("");
    console.log("PayWeb3 concat src:", srcForLog);
    console.log("MD5:", f.CHECKSUM);

    const fetch = global.fetch || require('node-fetch');
    const r = await fetch('https://secure.paygate.co.za/payweb3/initiate.trans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await r.text();
    const reply = Object.fromEntries(new URLSearchParams(text));

    if (reply.ERROR === 'DATA_CHK') {
      console.error('PayGate DATA_CHK error', { reply, srcForLog, checksum: f.CHECKSUM });
      return res.status(400).json({ success: false, message: 'Checksum mismatch from PayGate', reply, srcForLog, checksum: f.CHECKSUM });
    }

    if (reply.CHECKSUM) {
      const expect = buildInitiateReplyChecksum(reply, process.env.PAYGATE_ENCRYPTION_KEY);
      if (expect === reply.CHECKSUM) {
        console.log('PayWeb3 initiate successful', { reply });
        return res.json({ success: true, processUrl: 'https://secure.paygate.co.za/payweb3/process.trans', fields: { PAY_REQUEST_ID: reply.PAY_REQUEST_ID, CHECKSUM: reply.CHECKSUM } });
      } else {
        console.warn('Reply checksum mismatch', { expect, got: reply.CHECKSUM });
        return res.status(400).json({ success: false, message: 'Reply checksum mismatch', reply, expect, got: reply.CHECKSUM });
      }
    } else {
      console.warn('PayGate reply missing CHECKSUM', reply);
      return res.status(400).json({ success: false, message: 'PayGate reply missing CHECKSUM', reply });
    }
  } catch (e) {
    console.error('Error in /paygate/initiate:', e && e.message);
    return res.status(500).json({ success: false, message: e && e.message });
  }
});

// Self-check route for debugging checksum source and PayGate response
router.get('/paygate/selfcheck', async (req, res) => {
  try {
    const { orderId = 'TEST-123', amountRands = '1.00', email = '' } = req.query;
    const f = {
      PAYGATE_ID: process.env.PAYGATE_ID,
      REFERENCE: String(orderId),
      AMOUNT: String(Math.round(Number(amountRands) * 100)),
      CURRENCY: 'ZAR',
      RETURN_URL: process.env.PAYGATE_RETURN_URL,
      TRANSACTION_DATE: new Date().toISOString().slice(0, 19).replace('T', ' '),
      LOCALE: 'en-za',
      COUNTRY: 'ZAF',
      EMAIL: email || '',
      NOTIFY_URL: process.env.PAYGATE_NOTIFY_URL
    };

    const computedChecksum = buildInitiateChecksum(f, process.env.PAYGATE_ENCRYPTION_KEY);
    const srcForLog = [
      f.PAYGATE_ID, f.REFERENCE, f.AMOUNT, f.CURRENCY, f.RETURN_URL,
      f.TRANSACTION_DATE, f.LOCALE, f.COUNTRY, f.EMAIL, f.NOTIFY_URL
    ].join("");

    const fetch = global.fetch || require('node-fetch');
    const body = new URLSearchParams({ ...f, CHECKSUM: computedChecksum }).toString();
    const r = await fetch('https://secure.paygate.co.za/payweb3/initiate.trans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const text = await r.text();
    const reply = Object.fromEntries(new URLSearchParams(text));

    const report = {
      srcForLog,
      computedChecksum,
      bodySent: body,
      paygateReply: reply,
      status: r.status,
      diff: {
        checksumMatch: reply.CHECKSUM === computedChecksum,
        expectedReplyChecksum: reply.CHECKSUM ? buildInitiateReplyChecksum(reply, process.env.PAYGATE_ENCRYPTION_KEY) : null,
        replyChecksumValid: reply.CHECKSUM ? (buildInitiateReplyChecksum(reply, process.env.PAYGATE_ENCRYPTION_KEY) === reply.CHECKSUM) : false
      }
    };

    console.log('PayGate self-check report:', report);
    res.json(report);
  } catch (e) {
    console.error('Error in /paygate/selfcheck:', e && e.message);
    res.status(500).json({ error: e && e.message });
  }
});

// Self-test route to verify checksum builder with official PayGate test vector
router.get('/paygate/selftest', (req, res) => {
  const crypto = require('crypto');
  const md5 = s => crypto.createHash('md5').update(s).digest('hex');
  const fields = {
    PAYGATE_ID: "10011072130",
    REFERENCE: "pgtest_123456789",
    AMOUNT: "3299",
    CURRENCY: "ZAR",
    RETURN_URL: "https://my.return.url/page",
    TRANSACTION_DATE: "2018-01-01 12:00:00",
    LOCALE: "en-za",
    COUNTRY: "ZAF",
    EMAIL: "customer@paygate.co.za",
  };
  const src = Object.values(fields).join("") + "secret";
  const computedMd5 = md5(src);
  const expected = "59229d9c6cb336ae4bd287c87e6f0220";
  const match = computedMd5 === expected;
  res.json({ src, computedMd5, expected, match });
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
