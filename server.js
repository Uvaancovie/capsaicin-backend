const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3001', 
    'http://localhost:4000', 
    'https://capsaicin-frontend.vercel.app',
    'https://capsaicin-ecommerce.vercel.app',
    'https://your-vercel-app.vercel.app' // Replace with your actual Vercel domain
  ],
  credentials: true
}));
app.use(express.json());

// Mount PayGate routes
try {
  const paygateRoutes = require('./routes/paygate');
  app.use(paygateRoutes);
  console.log('Mounted paygate routes');
} catch (err) {
  console.warn('Paygate routes not mounted (file may be missing):', err.message);
}

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

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

    const invoice = new Invoice({
      invoice_number: generateInvoiceNumber(),
      customer_name,
      customer_email,
      customer_phone: customer_phone || '',
      customer_address: customer_address || '',
      items,
      subtotal,
      shipping_cost,
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
    const products = await Product.find();
    // Transform products to include id field for frontend compatibility
    const transformedProducts = products.map(product => ({
      ...product.toObject(),
      id: product._id.toString()
    }));
    res.json(transformedProducts);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
      error: error.message
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

// Start server
app.listen(PORT, () => {
  console.log(`Express server running at http://localhost:${PORT}`);
});
