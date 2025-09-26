const express = require('express');
const mongoose = require('mongoose');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
// CORS - allow configured frontends and local dev. Use FRONTEND_URL or FRONTEND_URLS (comma-separated)
// CORS - allow configured frontend origins and local dev.
// You can set FRONTEND_URL (single) or FRONTEND_URLS (comma-separated list) in Render env.
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_API_URL || 'https://capsaicin-frontend.vercel.app'
const FRONTEND_URLS = process.env.FRONTEND_URLS || ''
// Build allowed list: local dev hosts + any configured frontend URLs
const allowedFrontends = FRONTEND_URLS
  ? FRONTEND_URLS.split(',').map(s => s.trim()).filter(Boolean)
  : [FRONTEND_URL]

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server requests (no origin)
    if (!origin) return cb(null, true)
    const allowed = [
      'http://localhost:3000',
      'http://localhost:3001',
      ...allowedFrontends,
    ]
    if (allowed.includes(origin)) return cb(null, true)

    // Allow any subdomain or www for capepharm.co.za if needed
    try {
      const parsed = new URL(origin)
      const hostname = parsed.hostname || ''
      if (hostname === 'capepharm.co.za' || hostname.endsWith('.capepharm.co.za')) return cb(null, true)
    } catch (e) {
      // ignore URL parse errors
    }

    console.warn('CORS origin denied:', origin)
    return cb(new Error('CORS not allowed'), false)
  },
  credentials: true
}))

// Parse JSON and URL-encoded bodies
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Optional verbose request logger to help diagnose empty payloads/timeouts
// Set VERBOSE_REQUESTS=1 in your environment (Render env) to enable.
app.use((req, res, next) => {
  const verbose = String(process.env.VERBOSE_REQUESTS || '').trim() === '1'
  if (!verbose) return next()

  const start = Date.now()
  let bodyBytes = 0
  req.on && req.on('data', (chunk) => { try { bodyBytes += chunk.length } catch (e) {} })

  res.on('finish', () => {
    const ms = Date.now() - start
    const method = req.method
    const url = req.originalUrl || req.url
    const status = res.statusCode
    console.log(`VERBOSE: ${method} ${url} ${bodyBytes}-byte payload - ${status} ${ms}ms`)
  })

  next()
})

// Mount PayGate routes
try {
  const paygateRoutes = require('./routes/paygate');
  app.use(paygateRoutes);
  console.log('Mounted paygate routes');
} catch (err) {
  console.warn('Paygate routes not mounted (file may be missing):', err.message);
}

// Mount Ozow routes
try {
  const ozowRoutes = require('./routes/ozow');
  app.use(ozowRoutes);
  console.log('Mounted ozow routes');
} catch (err) {
  console.warn('Ozow routes not mounted (file may be missing):', err.message);
}

// MongoDB connection
// Connect to MongoDB with a reasonable serverSelectionTimeout so failures fail fast in production
// Connect to MongoDB with a larger poolSize to handle concurrent requests better
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: Number(process.env.MONGODB_POOL || 20) })
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err && err.message ? err.message : err));

// Create helpful indexes on startup (idempotent)
async function ensureIndexes() {
  try {
    const coll = mongoose.connection.collection('products');

    // Inspect existing indexes so we only create what's missing
    let existing = [];
    try {
      existing = await coll.indexes();
    } catch (ie) {
      // If indexes() isn't supported for some driver versions, fall back to attempting creates
      existing = [];
    }
    const existingNames = (existing || []).map(i => i && i.name).filter(Boolean);

    // Create category index if missing
    if (!existingNames.includes('category_1')) {
      try { await coll.createIndex({ category: 1 }, { name: 'category_1' }); } catch (e) { console.warn('Could not create category index:', e && e.message ? e.message : e); }
    }

    // Create text index for quick name/description search if missing
    const textIndexName = 'name_text_description_text';
    if (!existingNames.includes(textIndexName)) {
      try { await coll.createIndex({ name: 'text', description: 'text' }, { name: textIndexName }); } catch (e) { console.warn('Could not create text index:', e && e.message ? e.message : e); }
    }

    // Attempt to create a safe unique index on sku.
    // Some MongoDB environments reject partialFilterExpression expressions; as a safer fallback,
    // only create a strict unique index if there are no documents with missing/null sku values.
    try {
      // If driver supports partialFilterExpression, prefer that (best semantics)
      await coll.createIndex({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $exists: true, $ne: null } }, name: 'sku_unique_partial' });
    } catch (partialErr) {
      // Partial index creation failed (older Mongo / unsupported expression). Try a safer approach:
      try {
        const sample = await coll.find({ $or: [{ sku: { $exists: false } }, { sku: null }] }).limit(1).toArray();
        if (sample.length === 0) {
          // No null/absent skus found, create a strict unique index
          try { await coll.createIndex({ sku: 1 }, { unique: true, name: 'sku_unique' }); } catch (e) { console.warn('Could not create strict sku unique index:', e && e.message ? e.message : e); }
        } else {
          console.warn('Skipping strict sku unique index because there are existing documents with null/absent sku. Run a migration to populate skus before creating a unique index.');
        }
      } catch (probeErr) {
        console.warn('Could not probe for null/absent skus when attempting to create sku index:', probeErr && probeErr.message ? probeErr.message : probeErr);
      }
    }

    console.log('Product indexes ensured');
  } catch (e) {
    console.warn('Error ensuring indexes:', e && e.message ? e.message : e);
  }
}

// Run ensureIndexes after mongoose connects
mongoose.connection.on('connected', () => {
  ensureIndexes().catch(() => {});
});

// Use gzip/Brotli compression for responses
app.use(compression());

// --- File uploads (local dev fallback). For production prefer S3/Cloudinary ---
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const name = `img-${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  }
});

const fileFilter = (req, file, cb) => {
  if (!file.mimetype || !file.mimetype.match(/^image\/(jpeg|png|webp|gif|jpg)$/)) {
    return cb(new Error('Only image files are allowed'), false);
  }
  cb(null, true);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024) } });

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));

// Invoice Schema
const invoiceSchema = new mongoose.Schema({
  invoice_number: {
    type: String,
    required: true,
    unique: true
  },
  customer_name: {
    type: String,
    required: true
  },
  customer_email: {
    type: String,
    required: true
  },
  customer_phone: {
    type: String,
    default: ''
  },
  customer_address: {
    type: String,
    default: ''
  },
  items: [{
    name: String,
    quantity: Number,
    price: Number,
    total: Number
  }],
  subtotal: {
    type: Number,
    required: true
  },
  shipping_cost: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled'],
    default: 'pending'
  },
  shipping_method: {
    type: String,
    default: 'Standard Delivery'
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

// Product Schema (existing)
const productSchema = new mongoose.Schema({
  // SKU: if your DB has a unique index on sku, ensure we always provide one.
  sku: {
    type: String,
    required: false,
    // no unique here to avoid index re-creation if existing index differs; we will generate unique SKUs
    default: function() {
      return `SKU-${Date.now().toString(36)}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
    }
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  stock_quantity: {
    type: Number,
    required: true,
    default: 0
  },
  category: {
    type: String,
    required: true
  },
  image_url: {
    type: String,
    required: true
  },
  is_featured: {
    type: Boolean,
    default: false
  },
  ingredients: {
    type: String,
    default: ''
  },
  usage_instructions: {
    type: String,
    default: ''
  },
  benefits: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

const Product = mongoose.model('Product', productSchema);

// Generate unique invoice number
const generateInvoiceNumber = () => {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `INV-${timestamp.slice(-6)}-${random}`;
};

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Capsaicin Backend API is running!' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is healthy',
    timestamp: new Date().toISOString()
  });
});

// Invoice Routes
app.post('/invoices', async (req, res) => {
  try {
    console.log('Creating invoice with data:', req.body);
    
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      items,
      subtotal,
      shipping_cost,
      total,
      shipping_method,
      notes
    } = req.body;

    // If backend TEST_PRODUCT_ID is configured, force shipping_cost to 0 when any item matches
    const TEST_PRODUCT_ID_BACKEND = (process.env.TEST_PRODUCT_ID || '').trim()
    let finalShippingCost = shipping_cost
    try {
      if (TEST_PRODUCT_ID_BACKEND && Array.isArray(items)) {
        const hasTest = items.some(it => String(it.id) === TEST_PRODUCT_ID_BACKEND || String(it._id || '') === TEST_PRODUCT_ID_BACKEND || /test/i.test(String(it.id)) || /test/i.test(String(it.name)))
        if (hasTest) {
          finalShippingCost = 0
        }
      }
    } catch (err) {
      console.warn('Error checking test product id for invoice shipping override', err.message || err)
    }

    const invoice = new Invoice({
      invoice_number: generateInvoiceNumber(),
      customer_name,
      customer_email,
      customer_phone: customer_phone || '',
      customer_address: customer_address || '',
      items,
      subtotal,
      shipping_cost: finalShippingCost,
      total,
      shipping_method: shipping_method || 'Standard Delivery',
      notes: notes || ''
    });

    const savedInvoice = await invoice.save();
    console.log('Invoice created successfully:', savedInvoice.invoice_number);
    
    // Transform saved invoice to include id field for frontend compatibility
    const transformedInvoice = {
      ...savedInvoice.toObject(),
      id: savedInvoice._id.toString()
    };
    
    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      invoice: transformedInvoice
    });
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create invoice',
      error: error.message
    });
  }
});

app.get('/invoices', async (req, res) => {
  try {
    console.log('Fetching all invoices');
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    console.log(`Found ${invoices.length} invoices`);
    // Transform invoices to include id field for frontend compatibility
    const transformedInvoices = invoices.map(invoice => ({
      ...invoice.toObject(),
      id: invoice._id.toString()
    }));
    res.json(transformedInvoices);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: error.message
    });
  }
});

app.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }
    // Transform invoice to include id field for frontend compatibility
    const transformedInvoice = {
      ...invoice.toObject(),
      id: invoice._id.toString()
    };
    res.json(transformedInvoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice',
      error: error.message
    });
  }
});

app.put('/invoices/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    console.log(`Updating invoice ${req.params.id} status to: ${status}`);
    
    if (!['pending', 'processing', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    console.log('Invoice status updated successfully');
    res.json({
      success: true,
      message: 'Invoice status updated successfully',
      invoice
    });
  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update invoice status',
      error: error.message
    });
  }
});

// Admin Authentication
app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(`Admin login attempt for username: ${username}`);
    
    // Simple credential check (in production, use proper authentication)
    if (username === 'admincapepharm' && password === 'capepharm123$') {
      console.log('Admin login successful');
      res.json({
        success: true,
        message: 'Login successful',
        token: 'admin-token-' + Date.now() // Simple token for demo
      });
    } else {
      console.log('Admin login failed - invalid credentials');
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
  } catch (error) {
    console.error('Error during admin login:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Product Routes (existing functionality)
// Paginated, projected products endpoint with caching headers
app.get('/products', async (req, res) => {
  try {
    const start = Date.now();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(48, parseInt(req.query.limit || '24', 10));
    const skip = (page - 1) * limit;

    // Cache: 60s browser, 300s CDN/edge, with stale-while-revalidate
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');

    // Only select the fields needed for listing to reduce payload
    const projection = { name: 1, price: 1, image_url: 1, category: 1, stock_quantity: 1, sku: 1, description: 1 };
    const products = await Product.find({}, projection).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    const took = Date.now() - start;
    console.log(`Fetched products page=${page} limit=${limit} in ${took}ms`);

    // Add id field for frontend compatibility
    const transformedProducts = products.map(p => ({ ...p, id: String(p._id) }));
    res.json({ page, limit, items: transformedProducts });
  } catch (error) {
    console.error('Error fetching products:', error && error.message ? error.message : error);
    const isTimeout = error && (String(error.message).toLowerCase().includes('timeout') || String(error.message).toLowerCase().includes('timed out'))
    res.status(isTimeout ? 504 : 500).json({
      success: false,
      message: isTimeout ? 'Database timeout - please try again later' : 'Failed to fetch products',
      error: error && error.message ? error.message : String(error)
    });
  }
});

app.post('/products', upload.single('image'), async (req, res) => {
  try {
    console.log('Creating new product:', req.body, req.file && req.file.filename);
    const input = Object.assign({}, req.body || {});
    // If a file was uploaded, set image_url to the served path
    if (req.file && req.file.filename) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host');
      input.image_url = `${protocol}://${host}/uploads/${req.file.filename}`;
    }
    // If sku is missing or explicitly null/empty, generate one to avoid duplicate-key issues on sku index
    if (!input.sku || String(input.sku).trim() === '') {
      input.sku = `SKU-${Date.now().toString(36)}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
    }
    const product = new Product(input);
    let savedProduct;
    try {
      savedProduct = await product.save();
    } catch (err) {
      // If duplicate key on sku (null or collision), regenerate and retry once
      const isDupSku = err && (err.code === 11000) && err.keyPattern && err.keyPattern.sku;
      if (isDupSku) {
        console.warn('Duplicate SKU detected on save; regenerating SKU and retrying once');
        product.sku = `SKU-${Date.now().toString(36)}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;
        savedProduct = await product.save();
      } else throw err;
    }
    
    // Transform product to include id field for frontend compatibility
    const transformedProduct = {
      ...savedProduct.toObject(),
      id: savedProduct._id.toString()
    };
    
    console.log('Product created successfully');
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: transformedProduct
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
      error: error.message
    });
  }
});

app.put('/products/:id', upload.single('image'), async (req, res) => {
  try {
    console.log(`Updating product with ID: ${req.params.id}`, req.body, req.file && req.file.filename);
    const updateData = Object.assign({}, req.body || {});
    if (req.file && req.file.filename) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host');
      updateData.image_url = `${protocol}://${host}/uploads/${req.file.filename}`;
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!product) {
      console.log('Product not found');
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    console.log('Product updated successfully');
    // Transform product to include id field for frontend compatibility
    const transformedProduct = {
      ...product.toObject(),
      id: product._id.toString()
    };

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: transformedProduct
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: error.message
    });
  }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message
    });
  }
});

// Start server with increased timeout
const server = app.listen(PORT, () => {
  console.log(`Express server running at http://localhost:${PORT}`);
  console.log("PAYGATE key hint:", (process.env.PAYGATE_ENCRYPTION_KEY||"").replace(/^(.).*(.)$/,"$1***$2"));
})

// Increase server timeout so Render doesn't kill longer requests (120s)
try {
  server.setTimeout(120000)
} catch (e) {
  console.warn('Unable to set server timeout:', e && e.message)
}
