import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { db, initDatabase, mapProductRow } from './db.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
initDatabase();

// Configurar CORS com headers explícitos
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  // Garantir que a conexão será fechada
  res.on('finish', () => {
    console.log(`[${req.method} ${req.url}] Resposta enviada, status: ${res.statusCode}`);
  });
  next();
});

app.use(express.json({ limit: '1mb' }));

// Headers para garantir que conexões sejam fechadas
app.use((req, res, next) => {
  res.setHeader('Connection', 'close');
  next();
});

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-super-secret';
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payments = new Payment(mp);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const imagesDir = path.join(__dirname, '..', 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, imagesDir),
  filename: (_req, file, cb) => {
    const safeBase = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9.\-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'imagem';
    const ext = path.extname(safeBase) || '.jpg';
    const basename = path.basename(safeBase, ext);
    const finalName = `${basename}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, finalName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de imagem não suportado'));
    }
  }
});

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Token ausente' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function getAdminFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_) {
    return null;
  }
}

function buildProductListQuery(query) {
  const whereClauses = [];
  const params = {};

  const includeInactive = query.includeInactive === 'true';
  if (!includeInactive) {
    whereClauses.push('is_active = 1');
  }

  if (query.category) {
    whereClauses.push('category = @category');
    params.category = query.category.toLowerCase();
  }

  if (query.discounted === 'true') {
    whereClauses.push('discount_price IS NOT NULL');
  }

  if (query.featured === 'true') {
    whereClauses.push('featured = 1');
  }

  let sql = 'SELECT * FROM products';
  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }
  sql += ' ORDER BY featured DESC, updated_at DESC';

  const limit = Number.parseInt(query.limit, 10);
  if (!Number.isNaN(limit) && limit > 0) {
    sql += ' LIMIT @limit';
    params.limit = Math.min(limit, 100);
  }

  return { sql, params };
}

const productSchema = z.object({
  name: z.string().min(3),
  description: z.string().max(500).optional(),
  price: z.preprocess((v) => Number(v), z.number().nonnegative()),
  imageUrl: z.string().min(1),
  category: z.string().min(3),
  featured: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  discountPrice: z
    .preprocess((v) => (v === null || v === '' || typeof v === 'undefined' ? null : Number(v)), z.number().positive())
    .nullable()
    .optional()
});

const discountSchema = z.object({
  discountPrice: z.preprocess(
    (v) => {
      if (v === null || v === '' || typeof v === 'undefined') return null;
      const parsed = Number(v);
      return Number.isNaN(parsed) ? NaN : parsed;
    },
    z.union([z.number().positive(), z.null()])
  )
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const payload = loginSchema.safeParse(req.body);
    if (!payload.success) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    const { email, password } = payload.data;
    const admin = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email.toLowerCase());
    if (!admin) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, JWT_SECRET, {
      expiresIn: '8h'
    });
    res.json({ token, user: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (err) {
    console.error('[Admin Login] Erro:', err);
    res.status(500).json({ error: 'Falha ao autenticar' });
  }
});

app.get('/api/products', (req, res) => {
  try {
    const admin = getAdminFromRequest(req);
    const incomingQuery = { ...(req.query || {}) };
    if (!(admin && incomingQuery.includeInactive === 'true')) {
      incomingQuery.includeInactive = 'false';
    }
    const { sql, params } = buildProductListQuery(incomingQuery);
    const rows = db.prepare(sql).all(params);
    res.json({ products: rows.map(mapProductRow) });
  } catch (err) {
    console.error('[Products] Erro ao listar:', err);
    res.status(500).json({ error: 'Falha ao listar produtos' });
  }
});

app.post('/api/products', authenticateAdmin, (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
  }
  const product = parsed.data;

  if (product.discountPrice && product.discountPrice >= product.price) {
    return res.status(400).json({ error: 'Preço promocional deve ser menor que o preço original' });
  }

  const insert = db.prepare(`
    INSERT INTO products (name, description, price, image_url, category, featured, is_active, discount_price, discount_percent, updated_at)
    VALUES (@name, @description, @price, @image_url, @category, @featured, @is_active, @discount_price, @discount_percent, CURRENT_TIMESTAMP)
  `);

  const discountPercent = product.discountPrice
    ? Math.round((1 - product.discountPrice / product.price) * 100)
    : null;

  const result = insert.run({
    name: product.name,
    description: product.description || '',
    price: product.price,
    image_url: product.imageUrl,
    category: product.category.toLowerCase(),
    featured: product.featured ? 1 : 0,
    is_active: product.isActive === false ? 0 : 1,
    discount_price: product.discountPrice ?? null,
    discount_percent: discountPercent
  });

  const created = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ product: mapProductRow(created) });
});

app.put('/api/products/:id', authenticateAdmin, (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
  }
  const product = parsed.data;

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Produto não encontrado' });
  }

  if (product.discountPrice && product.discountPrice >= product.price) {
    return res.status(400).json({ error: 'Preço promocional deve ser menor que o preço original' });
  }

  const discountPercent = product.discountPrice
    ? Math.round((1 - product.discountPrice / product.price) * 100)
    : null;

  db.prepare(
    `UPDATE products 
     SET name=@name, description=@description, price=@price, image_url=@image_url, category=@category, 
         featured=@featured, is_active=@is_active, discount_price=@discount_price, discount_percent=@discount_percent,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=@id`
  ).run({
    id: req.params.id,
    name: product.name,
    description: product.description || '',
    price: product.price,
    image_url: product.imageUrl,
    category: product.category.toLowerCase(),
    featured: product.featured ? 1 : 0,
    is_active: product.isActive === false ? 0 : 1,
    discount_price: product.discountPrice ?? null,
    discount_percent: discountPercent
  });

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({ product: mapProductRow(updated) });
});

app.patch('/api/products/:id/discount', authenticateAdmin, (req, res) => {
  const parsed = discountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Informe um valor válido' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Produto não encontrado' });
  }
  const discountPrice = parsed.data.discountPrice;
  if (discountPrice !== null && discountPrice >= product.price) {
    return res.status(400).json({ error: 'Preço promocional deve ser menor que o preço original' });
  }

  const discountPercent =
    discountPrice !== null ? Math.round((1 - discountPrice / product.price) * 100) : null;

  db.prepare(
    `UPDATE products 
     SET discount_price=@discount_price, discount_percent=@discount_percent, updated_at=CURRENT_TIMESTAMP 
     WHERE id=@id`
  ).run({
    id: req.params.id,
    discount_price: discountPrice,
    discount_percent: discountPercent
  });

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({ product: mapProductRow(updated) });
});

app.patch('/api/products/:id/toggle', authenticateAdmin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Produto não encontrado' });
  }
  db.prepare(
    'UPDATE products SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at=CURRENT_TIMESTAMP WHERE id = ?'
  ).run(req.params.id);
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({ product: mapProductRow(updated) });
});

app.delete('/api/products/:id', authenticateAdmin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Produto não encontrado' });
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

app.post('/api/uploads/image', authenticateAdmin, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo não enviado' });
    }
    const relativePath = `images/${req.file.filename}`;
    res.status(201).json({ path: relativePath, url: relativePath });
  } catch (err) {
    console.error('[Upload] Erro ao salvar imagem:', err);
    res.status(500).json({ error: 'Falha ao processar upload' });
  }
});

function moneyBRL(n) { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n); }

// PIX checkout
app.post('/api/checkout/pix', async (req, res) => {
  console.log('[PIX] Requisição recebida!');
  try {
    const { amount, payer, items } = req.body || {};
    console.log('[PIX] Dados recebidos:', { amount, payer: payer?.email, itemsCount: items?.length || 0 });
    
    const transaction_amount = Number(amount) || 0;
    
    if (!transaction_amount || transaction_amount <= 0) {
      console.error('[PIX] Valor inválido:', amount);
      return res.status(400).json({ error: 'Valor inválido' });
    }

    if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN === 'YOUR_MERCADO_PAGO_ACCESS_TOKEN') {
      console.error('[PIX] MP_ACCESS_TOKEN não configurado no .env');
      return res.status(500).json({ error: 'Token do Mercado Pago não configurado. Verifique o arquivo .env' });
    }

    // Verificar formato do token
    const tokenPreview = process.env.MP_ACCESS_TOKEN.substring(0, 10) + '...';
    console.log('[PIX] Token do MP (preview):', tokenPreview);
    if (!process.env.MP_ACCESS_TOKEN.startsWith('TEST-') && !process.env.MP_ACCESS_TOKEN.startsWith('APP_USR-')) {
      console.error('[PIX] Token não começa com TEST- ou APP_USR-');
      return res.status(500).json({ error: 'Token do Mercado Pago inválido. Deve começar com TEST- (testes) ou APP_USR- (produção)' });
    }

    console.log('[PIX] Criando pagamento de R$', transaction_amount);

    // Verificar se o token tem o tamanho correto (tokens do MP são longos)
    const tokenLength = process.env.MP_ACCESS_TOKEN.length;
    console.log('[PIX] Comprimento do token:', tokenLength);
    if (tokenLength < 50) {
      console.error('[PIX] Token muito curto! Pode estar incompleto.');
      return res.status(500).json({ error: 'Token do Mercado Pago parece estar incompleto. Verifique se copiou o token completo.' });
    }

    const body = {
      transaction_amount,
      description: 'Pedido Loja Street',
      payment_method_id: 'pix',
      payer: { 
        email: payer?.email || 'test_user_123@test.com',
        first_name: payer?.nome?.split(' ')[0] || 'Teste',
        last_name: payer?.nome?.split(' ').slice(1).join(' ') || 'Usuario'
      },
      metadata: {
        name: payer?.nome || '',
        phone: payer?.telefone || '',
        items: (items || []).map(i => ({ title: i.title, size: i.size, color: i.color, qty: i.qty, price: i.price }))
      }
    };

    console.log('[PIX] Body da requisição:', JSON.stringify(body, null, 2));

    const resp = await payments.create({ body });
    const tx = resp?.point_of_interaction?.transaction_data || {};
    
    console.log('[PIX] Pagamento criado:', resp?.id, 'Status:', resp?.status);
    console.log('[PIX] QR Code disponível:', !!tx.qr_code_base64);
    
    const responseData = {
      id: resp?.id,
      status: resp?.status,
      qr_code: tx.qr_code,
      qr_base64: tx.qr_code_base64,
      copy_and_paste: tx.qr_code,
      amount: transaction_amount
    };
    
    console.log('[PIX] Enviando resposta ao frontend...');
    res.json(responseData);
    console.log('[PIX] Resposta enviada com sucesso');
  } catch (err) {
    console.error('[PIX] Erro capturado:', err?.message || err);
    console.error('[PIX] Stack:', err?.stack);
    
    if (!res.headersSent) {
      const errorMsg = err?.message || '';
      if (errorMsg.includes('401') || errorMsg.includes('UNAUTHORIZED')) {
        res.status(500).json({ 
          error: 'Token do Mercado Pago inválido ou sem permissões. Verifique: 1) Token está correto no .env 2) Token não expirou 3) Usa token de TESTE (TEST-...) para testes',
          hint: 'Obtenha um novo token em: https://www.mercadopago.com.br/developers/panel/app'
        });
      } else if (errorMsg.includes('404')) {
        res.status(500).json({ error: 'Endpoint do Mercado Pago não encontrado. Verifique a versão da API.' });
      } else {
        res.status(500).json({ error: 'Falha ao criar PIX: ' + errorMsg });
      }
    }
  }
});

// Webhook do Mercado Pago
app.post('/api/webhooks/mp', async (req, res) => {
  try {
    const data = req.body;
    console.log('[Webhook] Recebido:', data?.type, data?.action);
    
    // Em produção, validar assinatura/hmac aqui
    if (data?.type === 'payment' && data?.data?.id) {
      const paymentId = data.data.id;
      
      try {
        // Buscar detalhes do pagamento
        const payment = await payments.get({ id: paymentId });
        const status = payment?.status;
        const amount = payment?.transaction_amount || 0;
        const payerEmail = payment?.payer?.email || '';
        const metadata = payment?.metadata || {};
        
        console.log('[Webhook] Pagamento:', paymentId, 'Status:', status);
        
        if (resend) {
          // E-mail para o cliente quando pagamento aprovado
          if (status === 'approved' && payerEmail) {
            try {
              await resend.emails.send({
                from: process.env.EMAIL_FROM,
                to: payerEmail,
                subject: '✅ Pagamento Aprovado - Loja Street',
                html: `
                  <h2>Pagamento Confirmado!</h2>
                  <p>Olá ${metadata.name || 'Cliente'},</p>
                  <p>Seu pagamento de ${moneyBRL(amount)} foi aprovado com sucesso!</p>
                  <p><strong>Número do pedido:</strong> ${paymentId}</p>
                  <p>Em breve você receberá mais informações sobre o envio do seu pedido.</p>
                  <p>Obrigado pela compra!</p>
                `
              });
              console.log('[Email] Enviado para cliente:', payerEmail);
            } catch (emailErr) {
              console.error('[Email] Erro ao enviar para cliente:', emailErr?.message);
            }
          }
          
          // E-mail para admin quando pagamento aprovado
          if (status === 'approved' && process.env.EMAIL_ADMIN) {
            try {
              await resend.emails.send({
                from: process.env.EMAIL_FROM,
                to: process.env.EMAIL_ADMIN,
                subject: `💰 Novo Pagamento Aprovado - ${moneyBRL(amount)}`,
                html: `
                  <h2>Novo pagamento aprovado!</h2>
                  <p><strong>ID:</strong> ${paymentId}</p>
                  <p><strong>Valor:</strong> ${moneyBRL(amount)}</p>
                  <p><strong>Cliente:</strong> ${metadata.name || 'N/A'}</p>
                  <p><strong>E-mail:</strong> ${payerEmail}</p>
                  <p><strong>Telefone:</strong> ${metadata.phone || 'N/A'}</p>
                  <p><strong>Status:</strong> ${status}</p>
                `
              });
              console.log('[Email] Notificação enviada para admin');
            } catch (emailErr) {
              console.error('[Email] Erro ao enviar para admin:', emailErr?.message);
            }
          }
        }
      } catch (err) {
        console.error('[Webhook] Erro ao processar:', err?.message);
      }
    }
    
    res.sendStatus(200);
  } catch (e) {
    console.error('[Webhook] Erro geral:', e?.message);
    res.sendStatus(200); // Sempre retorna 200 para o MP
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Endpoint de teste do token do Mercado Pago
app.get('/api/test-mp', async (_req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN === 'YOUR_MERCADO_PAGO_ACCESS_TOKEN') {
      return res.status(500).json({ error: 'Token não configurado' });
    }

    const tokenPreview = process.env.MP_ACCESS_TOKEN.substring(0, 15) + '...';
    const tokenLength = process.env.MP_ACCESS_TOKEN.length;
    const tokenType = process.env.MP_ACCESS_TOKEN.startsWith('TEST-') ? 'TESTE' : 
                     process.env.MP_ACCESS_TOKEN.startsWith('APP_USR-') ? 'PRODUÇÃO' : 'DESCONHECIDO';

    // Tentar criar um pagamento de teste muito pequeno
    const testBody = {
      transaction_amount: 0.01,
      description: 'Teste de conexão',
      payment_method_id: 'pix',
      payer: { email: 'test@test.com' }
    };

    try {
      const testResp = await payments.create({ body: testBody });
      res.json({
        success: true,
        tokenPreview,
        tokenLength,
        tokenType,
        message: 'Token está funcionando!',
        paymentId: testResp?.id
      });
    } catch (testErr) {
      res.status(500).json({
        success: false,
        tokenPreview,
        tokenLength,
        tokenType,
        error: testErr?.message || 'Erro desconhecido',
        hint: testErr?.message?.includes('UNAUTHORIZED') ? 
          'Token sem permissões. Verifique se a aplicação está ativa e tem permissão para criar pagamentos PIX.' :
          'Token pode estar inválido ou expirado.'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro ao testar token' });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});


