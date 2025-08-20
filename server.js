require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');
const app = express();
const sql = neon(process.env.DATABASE_URL);

// Enable CORS for frontend - allow multiple origins for production
const allowedOrigins = [
  'http://localhost:3001', // Local development
  'http://localhost:3000', // Local development alternative
  process.env.FRONTEND_URL, // Production frontend URL (will be set in Render)
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

const { registerUser, loginUser } = require('./auth');

// Health check
app.get('/', async (req, res) => {
  try {
    const result = await sql`SELECT version()`;
    res.json({ version: result[0].version });
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

// Products endpoint (example)
app.get('/products', async (req, res) => {
  try {
    const products = await sql`SELECT * FROM products ORDER BY created_at DESC`;
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Failed to fetch products', details: err.message });
  }
});

// Add new product (admin)
app.post('/products', async (req, res) => {
  const { name, description, price, stock_quantity, category, image_url } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }
  
  try {
    const result = await sql`
      INSERT INTO products (name, description, price, stock_quantity, category, image_url)
      VALUES (${name}, ${description || ''}, ${price}, ${stock_quantity || 0}, ${category || ''}, ${image_url || ''})
      RETURNING *
    `;
    console.log('Product added:', result[0]);
    res.json(result[0]);
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ error: 'Failed to add product', details: err.message });
  }
});

// Update product (admin)
app.put('/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, price, stock_quantity, category, image_url } = req.body;
  
  try {
    const result = await sql`
      UPDATE products 
      SET name = ${name}, description = ${description}, price = ${price}, 
          stock_quantity = ${stock_quantity}, category = ${category}, 
          image_url = ${image_url}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `;
    if (result.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result[0]);
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product', details: err.message });
  }
});

// Delete product (admin)
app.delete('/products/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await sql`DELETE FROM products WHERE id = ${id} RETURNING *`;
    if (result.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product', details: err.message });
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
