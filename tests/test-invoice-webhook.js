const fetch = require('node-fetch');
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function run() {
  try {
    console.log('Creating test invoice...');
    const invoiceRes = await fetch(`${API_BASE}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Test User',
        customer_email: 'test@example.com',
        customer_phone: '0123456789',
        customer_address: '123 Test Lane',
        items: [{ name: 'Sample', quantity: 1, price: 10, total: 10 }],
        subtotal: 10,
        shipping_cost: 0,
        total: 10,
        shipping_method: 'Standard'
      })
    });
    const created = await invoiceRes.json();
    console.log('Created invoice:', created.invoice && created.invoice.invoice_number);

    const invoiceNumber = created.invoice && created.invoice.invoice_number;
    if (!invoiceNumber) return console.error('No invoice number returned');

    console.log('Simulating Ozow notify...');
    const notifyRes = await fetch(`${API_BASE}/ozow/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `TransactionReference=${encodeURIComponent(invoiceNumber)}&Status=Success&Hash=invalid` // invalid hash to test failure logging
    });
    console.log('Notify response status:', notifyRes.status);
    const txt = await notifyRes.text();
    console.log('Notify response body:', txt);

    console.log('Fetching webhook failures...');
    const wf = await fetch(`${API_BASE}/webhook-failures`);
    try {
      const list = await wf.json();
      console.log('Webhook failures count:', Array.isArray(list) ? list.length : 'N/A');
    } catch (e) {
      console.warn('Could not fetch webhook failures route:', e.message);
    }

  } catch (e) {
    console.error('Test failed', e);
  }
}

run();
