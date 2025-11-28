import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'loja.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const productTableSQL = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL CHECK(price >= 0),
  image_url TEXT,
  category TEXT NOT NULL,
  featured INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  discount_price REAL,
  discount_percent REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

const adminTableSQL = `
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

db.exec(productTableSQL);
db.exec(adminTableSQL);

function ensureDefaultAdmin() {
  const defaultEmail = (process.env.ADMIN_DEFAULT_EMAIL || 'admin@lojastreet.com').toLowerCase();
  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
  const defaultName = process.env.ADMIN_DEFAULT_NAME || 'Administrador';

  const existing = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(defaultEmail);
  if (!existing) {
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);
    db.prepare('INSERT INTO admin_users (email, name, password_hash) VALUES (?, ?, ?)').run(
      defaultEmail,
      defaultName,
      passwordHash
    );
    console.log(`[DB] Admin padrão criado (${defaultEmail}). Altere a senha o quanto antes.`);
  }
}

function seedProducts() {
  const total = db.prepare('SELECT COUNT(*) AS total FROM products').get().total;
  if (total > 0) return;

  const baseProducts = [
    {
      name: 'Camiseta Oversized',
      description: 'Modelagem ampla em algodão premium.',
      price: 99.9,
      image_url: 'images/fem-blusa.jpg',
      category: 'feminino',
      featured: 1
    },
    {
      name: 'Vestido T-Shirt Oversized',
      description: 'Perfeito para o dia-a-dia com toque macio.',
      price: 149.9,
      image_url: 'images/fem-vestido.jpg',
      category: 'feminino',
      featured: 1
    },
    {
      name: 'Sneaker Chunky Feminino',
      description: 'Solado robusto e conforto máximo.',
      price: 259.9,
      image_url: 'images/fem-sneaker.jpg',
      category: 'feminino'
    },
    {
      name: 'Hoodie Oversized',
      description: 'Moleton felpado com capuz estruturado.',
      price: 169.9,
      image_url: 'images/mas-moleton.jpg',
      category: 'masculino',
      featured: 1
    },
    {
      name: 'Cargo Relaxed Fit',
      description: 'Calça cargo com múltiplos bolsos utilitários.',
      price: 199.9,
      image_url: 'images/mas-jeans.jpg',
      category: 'masculino'
    },
    {
      name: 'Sneaker Chunky Masculino',
      description: 'Design imponente com amortecimento.',
      price: 289.9,
      image_url: 'images/mas-sneaker.jpg',
      category: 'masculino'
    },
    {
      name: 'Boné Trucker Street',
      description: 'Ajuste snapback e tela traseira.',
      price: 79.9,
      image_url: 'images/acc-bone.jpg',
      category: 'acessorios',
      featured: 1
    },
    {
      name: 'Óculos Street Retangular',
      description: 'Lentes com proteção UV400.',
      price: 119.9,
      image_url: 'images/acc-oculos.jpg',
      category: 'acessorios'
    },
    {
      name: 'Carteira Minimal Preto',
      description: 'Couro ecológico com acabamento texturizado.',
      price: 59.9,
      image_url: 'images/acc-carteira.jpg',
      category: 'acessorios'
    },
    {
      name: 'Hoodie Oversized Promo',
      description: 'Mesma qualidade com valor promocional.',
      price: 169.9,
      discount_price: 119.9,
      image_url: 'images/promo-hoodie.jpg',
      category: 'masculino',
      featured: 1
    },
    {
      name: 'Camiseta Gráfica Oversized Promo',
      description: 'Estampa exclusiva limitada.',
      price: 149.9,
      discount_price: 119.9,
      image_url: 'images/promo-graphictee.jpg',
      category: 'unissex',
      featured: 1
    },
    {
      name: 'Jaqueta Corta Vento Tech Promo',
      description: 'Tecido impermeável e respirável.',
      price: 299.9,
      discount_price: 239.9,
      image_url: 'images/promo-cortavento.jpg',
      category: 'masculino',
      featured: 1
    }
  ];

  const insert = db.prepare(`
    INSERT INTO products (name, description, price, image_url, category, featured, discount_price, discount_percent)
    VALUES (@name, @description, @price, @image_url, @category, @featured, @discount_price, @discount_percent)
  `);

  const now = new Date().toISOString();
  const tx = db.transaction((items) => {
    for (const item of items) {
      const discountPercent = item.discount_price
        ? Math.round((1 - item.discount_price / item.price) * 100)
        : null;
      insert.run({
        ...item,
        featured: item.featured ? 1 : 0,
        discount_price: item.discount_price || null,
        discount_percent: discountPercent,
        created_at: now,
        updated_at: now
      });
    }
  });

  tx(baseProducts);
  console.log('[DB] Produtos base inseridos.');
}

export function initDatabase() {
  ensureDefaultAdmin();
  seedProducts();
}

export function mapProductRow(row) {
  if (!row) return null;
  const finalPrice = row.discount_price ?? row.price;
  const discountPercent =
    row.discount_percent ??
    (row.discount_price ? Math.round((1 - row.discount_price / row.price) * 100) : null);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.image_url,
    category: row.category,
    featured: Boolean(row.featured),
    isActive: Boolean(row.is_active),
    discountPrice: row.discount_price ?? null,
    discountPercent,
    finalPrice,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export { db };


