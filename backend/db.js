import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

// Pool de conexões MySQL usando variáveis do .env
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10
});

// Wrapper simples para facilitar o uso no server.js
export const db = {
  async query(sql, params = []) {
    return pool.query(sql, params);
  },
  async get(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  },
  async all(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
  }
};

async function ensureTables() {
  // Cria as tabelas caso ainda não existam
  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL,
      image_url VARCHAR(500),
      category VARCHAR(50) NOT NULL,
      featured TINYINT(1) DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      discount_price DECIMAL(10,2) NULL,
      discount_percent DECIMAL(5,2) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureDefaultAdmin() {
  const defaultEmail = (process.env.ADMIN_DEFAULT_EMAIL || 'admin@lojastreet.com').toLowerCase();
  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
  const defaultName = process.env.ADMIN_DEFAULT_NAME || 'Administrador';

  const existing = await db.get('SELECT id FROM admin_users WHERE email = ?', [defaultEmail]);
  if (!existing) {
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    await db.query(
      'INSERT INTO admin_users (email, name, password_hash) VALUES (?, ?, ?)',
      [defaultEmail, defaultName, passwordHash]
    );
    console.log(`[DB] Admin padrão criado (${defaultEmail}). Altere a senha o quanto antes.`);
  }
}

export async function initDatabase() {
  await ensureTables();
  await ensureDefaultAdmin();
}

export function mapProductRow(row) {
  if (!row) return null;
  const finalPrice =
    row.discount_price !== null && row.discount_price !== undefined
      ? Number(row.discount_price)
      : Number(row.price);

  const discountPercent =
    row.discount_percent !== null && row.discount_percent !== undefined
      ? Number(row.discount_percent)
      : row.discount_price
      ? Math.round(
          (1 - Number(row.discount_price) / Number(row.price)) * 100
        )
      : null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    imageUrl: row.image_url,
    category: row.category,
    featured: Boolean(row.featured),
    isActive: Boolean(row.is_active),
    discountPrice:
      row.discount_price !== null && row.discount_price !== undefined
        ? Number(row.discount_price)
        : null,
    discountPercent,
    finalPrice,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}