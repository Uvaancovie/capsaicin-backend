require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function checkTableStructure() {
  try {
    console.log('Checking users table structure...');
    
    // Get table columns
    const columns = await sql`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position
    `;
    
    console.log('Current users table structure:');
    columns.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Drop and recreate the table with correct structure
    console.log('\nDropping existing users table...');
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    
    console.log('Creating new users table...');
    await sql`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    console.log('✅ Users table recreated successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkTableStructure();
