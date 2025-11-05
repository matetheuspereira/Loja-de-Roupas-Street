Setup (Windows)

1) Instalar Node 18+
2) cd backend && npm install
3) Copiar .env.example para .env e preencher:
   - MP_ACCESS_TOKEN (Mercado Pago, modo sandbox primeiro)
   - RESEND_API_KEY (ou outro provedor de email)
   - EMAIL_FROM, EMAIL_ADMIN
4) npm start (porta padrão 3001)

Endpoints
- POST /api/checkout/pix → cria pagamento PIX e retorna qr_code_base64 e copia-e-cola
- POST /api/webhooks/mp → webhook do Mercado Pago para atualizar status e disparar e-mail

No front aponte para http://localhost:3001/api

