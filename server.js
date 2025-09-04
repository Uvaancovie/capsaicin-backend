require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');
const app = express();

// Optimized database connection with pooling
const sql = neon(process.env.DATABASE_URL, {
  poolSize: 10,
  idleTimeout: 30000,
  queryTimeout: 60000
});

// Optimized CORS configuration for production
const corsOptions = {
  origin: [
    'http://localhost:3001',
    'http://localhost:3000',
    'https://capsaicin-frontend.vercel.app',
    'https://capsaicin-frontend-git-main-uvaancovies-projects.vercel.app',
    'https://capsaicin-frontend-uvaancovies-projects.vercel.app',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// Add compression for better performance
const compression = require('compression');
app.use(compression());

// Add request parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add response time header for monitoring
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    res.set('X-Response-Time', `${duration}ms`);
    if (duration > 1000) {
      console.log(`Slow request: ${req.method} ${req.path} - ${duration}ms`);
    }
  });
  next();
});

const { registerUser, loginUser } = require('./auth');

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Capsaicin Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint with database check
app.get('/', async (req, res) => {
  try {
    const result = await sql`SELECT version()`;
    res.json({ 
      message: 'Capsaicin Backend API',
      database: 'Connected',
      version: result[0].version,
      endpoints: {
        health: '/health',
        products: '/products',
        auth: {
          register: '/register',
          login: '/login'
        }
      }
    });
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// Initialize database tables
app.post('/init-db', async (req, res) => {
  try {
    // Create users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    // Create products table
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        stock_quantity INTEGER DEFAULT 0,
        image_url VARCHAR(255),
        category VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    console.log('Database tables created successfully');
    res.json({ message: 'Database initialized successfully' });
  } catch (err) {
    console.error('Database initialization error:', err);
    res.status(500).json({ error: 'Database initialization failed', details: err.message });
  }
});

// In-memory cache for products (simple caching)
let productsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Optimized products endpoint with caching
app.get('/products', async (req, res) => {
  try {
    const now = Date.now();
    
    // Return cached data if still valid
    if (productsCache && (now - cacheTimestamp) < CACHE_DURATION) {
      res.set('X-Cache', 'HIT');
      return res.json(productsCache);
    }
    
    // Fetch from database with optimized query
    const products = await sql`
      SELECT id, name, description, price::text, stock_quantity, image_url, category, created_at 
      FROM products 
      ORDER BY created_at DESC 
      LIMIT 100
    `;
    
    // Update cache
    productsCache = products;
    cacheTimestamp = now;
    
    res.set('X-Cache', 'MISS');
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Optimized add new product endpoint
app.post('/products', async (req, res) => {
  const { name, description, price, stock_quantity, category, image_url } = req.body;
  
  // Enhanced validation
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
    return res.status(400).json({ error: 'Valid price is required' });
  }
  
  try {
    const result = await sql`
      INSERT INTO products (name, description, price, stock_quantity, category, image_url)
      VALUES (
        ${name.trim()}, 
        ${description?.trim() || ''}, 
        ${parseFloat(price)}, 
        ${parseInt(stock_quantity) || 0}, 
        ${category?.trim() || ''}, 
        ${image_url?.trim() || ''}
      )
      RETURNING id, name, description, price::text, stock_quantity, category, image_url, created_at
    `;
    
    // Clear cache when new product is added
    productsCache = null;
    
    console.log('Product added:', result[0]);
    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

// Optimized update product endpoint
app.put('/products/:id', async (req, res) => {
  const productId = parseInt(req.params.id);
  const { name, description, price, stock_quantity, category, image_url } = req.body;
  
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }
  
  try {
    const result = await sql`
      UPDATE products 
      SET 
        name = ${name?.trim() || name}, 
        description = ${description?.trim() || description}, 
        price = ${parseFloat(price) || price}, 
        stock_quantity = ${parseInt(stock_quantity) || stock_quantity}, 
        category = ${category?.trim() || category}, 
        image_url = ${image_url?.trim() || image_url}, 
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${productId}
      RETURNING id, name, description, price::text, stock_quantity, category, image_url, updated_at
    `;
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Clear cache when product is updated
    productsCache = null;
    
    res.json(result[0]);
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Optimized delete product endpoint
app.delete('/products/:id', async (req, res) => {
  const productId = parseInt(req.params.id);
  
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }
  
  try {
    const result = await sql`DELETE FROM products WHERE id = ${productId} RETURNING id`;
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Clear cache when product is deleted
    productsCache = null;
    
    res.json({ message: 'Product deleted successfully', id: productId });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Cart endpoint (example)
app.post('/cart', async (req, res) => {
  // TODO: Implement cart logic
  res.json({ message: 'Cart endpoint placeholder' });
});

// Orders endpoint (example)
app.post('/orders', async (req, res) => {
  // TODO: Implement order logic
  res.json({ message: 'Order endpoint placeholder' });
});

// Auth endpoints
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    console.log('Attempting to register user:', email);
    const user = await registerUser(email, password);
    console.log('User registered successfully:', user);
    res.json({ user });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await loginUser(email, password);
    if (!result) return res.status(401).json({ error: 'Invalid credentials' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running at http://localhost:${PORT}`);
});
