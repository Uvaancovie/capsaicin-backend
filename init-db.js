require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function initDatabase() {
  try {
    console.log('Testing database connection...');
    
    // Test connection
    const version = await sql`SELECT version()`;
    console.log('✅ Database connected successfully');
    console.log('Database version:', version[0].version);
    
    // Create users table
    console.log('Creating users table...');
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Users table created');
    
    // Create products table
    console.log('Creating products table...');
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
    console.log('✅ Products table created');
    
    // Insert sample products
    console.log('Inserting sample products...');
    const existingProducts = await sql`SELECT COUNT(*) FROM products`;
    if (existingProducts[0].count === '0') {
      await sql`
        INSERT INTO products (name, description, price, stock_quantity, category) VALUES 
        ('Capsaicin Relief Cream 30ml', 'Fast-acting heat therapy cream for joint and muscle pain relief', 19.99, 100, 'topical'),
        ('Capsaicin Relief Cream 60ml', 'Larger size heat therapy cream for extended use', 34.99, 50, 'topical'),
        ('Capsaicin Relief Roll-on', 'Convenient roll-on applicator for targeted relief', 24.99, 75, 'topical')
      `;
      console.log('✅ Sample products inserted');
    } else {
      console.log('✅ Products already exist, skipping insertion');
    }
    
    console.log('\n🎉 Database initialization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  }
}

initDatabase();
