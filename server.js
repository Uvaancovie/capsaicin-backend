const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
// CORS - allow Vercel frontend and local dev. FRONTEND_URL env can be set to your Vercel domain.
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_API_URL || 'https://capsaicin-frontend.vercel.app'
app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server requests (no origin)
    if (!origin) return cb(null, true)
    const allowed = [
      'http://localhost:3000',
      'http://localhost:3001',
      FRONTEND_URL,
    ]
    if (allowed.includes(origin)) return cb(null, true)
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

// MongoDB connection
// Connect to MongoDB with a reasonable serverSelectionTimeout so failures fail fast in production
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err && err.message ? err.message : err));

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
app.get('/products', async (req, res) => {
  try {
  const start = Date.now()
  const products = await Product.find();
  const took = Date.now() - start
  console.log(`Fetched products in ${took}ms`)
    // Transform products to include id field for frontend compatibility
    const transformedProducts = products.map(product => ({
      ...product.toObject(),
      id: product._id.toString()
    }));
    res.json(transformedProducts);
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

app.post('/products', async (req, res) => {
  try {
    console.log('Creating new product:', req.body);
    const product = new Product(req.body);
    const savedProduct = await product.save();
    
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

app.put('/products/:id', async (req, res) => {
  try {
    console.log(`Updating product with ID: ${req.params.id}`);
    console.log('Update data:', req.body);
    
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
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
})

// Increase server timeout so Render doesn't kill longer requests (120s)
try {
  server.setTimeout(120000)
} catch (e) {
  console.warn('Unable to set server timeout:', e && e.message)
}
