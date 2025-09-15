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
    fields.HashCheck = buildOzowHash(fields, privateKey);

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

    console.log('Ozow notify verified', { transactionRef, status });
    res.set('Content-Type', 'text/plain');
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Error in /ozow/notify:', err && err.message);
    res.status(500).send('ERROR');
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
