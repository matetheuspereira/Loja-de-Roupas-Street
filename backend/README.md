Setup (Windows)

1) Instalar Node 18+
2) cd backend && npm install
3) Copiar .env.example para .env e preencher:
   - MP_ACCESS_TOKEN (Mercado Pago, modo sandbox primeiro)
   - RESEND_API_KEY (ou outro provedor de email)
   - EMAIL_FROM, EMAIL_ADMIN
   - JWT_SECRET (qualquer string forte)
   - ADMIN_DEFAULT_EMAIL (login inicial do painel)
   - ADMIN_DEFAULT_PASSWORD (senha inicial do painel)
   - ADMIN_DEFAULT_NAME (opcional)
   - DB_PATH (opcional, caminho customizado para o SQLite)
4) npm start (porta padrão 3001)

Banco de dados / Admin
- Os dados dos produtos ficam em um SQLite salvo em `../data/loja.db` (diretório criado automaticamente e ignorado pelo git).
- Na primeira execução um admin padrão e os produtos base são criados com os valores definidos nas variáveis acima.
- Para gerenciar o catálogo, abra `admin.html` no front, autentique-se e utilize o painel para adicionar produtos, ativar/desativar itens e configurar promoções.

Endpoints
- POST /api/checkout/pix → cria pagamento PIX e retorna qr_code_base64 e copia-e-cola
- POST /api/webhooks/mp → webhook do Mercado Pago para atualizar status e disparar e-mail
- GET /api/products → lista produtos (com filtros ?category=, ?discounted=, ?featured=, ?limit=). `includeInactive=true` só funciona com token de admin.
- POST /api/admin/login → retorna token JWT para uso nos endpoints protegidos abaixo.
- POST /api/products (admin) → cria produto
- PUT /api/products/:id (admin) → atualiza produto completo
- PATCH /api/products/:id/discount (admin) → cria/atualiza/remove oferta
- PATCH /api/products/:id/toggle (admin) → ativa/desativa produto
- DELETE /api/products/:id (admin) → remove produto

No front aponte para http://localhost:3001/api

