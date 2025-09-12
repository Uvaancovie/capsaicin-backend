const express = require('express');
const router = express.Router();
const crypto = require('crypto');

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

module.exports = router;
