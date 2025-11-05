import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { Resend } from 'resend';

const app = express();

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
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payments = new Payment(mp);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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


