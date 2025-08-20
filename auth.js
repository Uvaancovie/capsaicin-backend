const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

async function registerUser(email, password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  // Create user in DB
  const result = await sql`INSERT INTO users (email, password) VALUES (${email}, ${hashedPassword}) RETURNING id, email`;
  return result[0];
}

async function loginUser(email, password) {
  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (!users.length) return null;
  const user = users[0];
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  // Generate JWT
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1d' });
  return { token, user: { id: user.id, email: user.email } };
}

module.exports = { registerUser, loginUser };
