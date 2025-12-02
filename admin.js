document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('admin-login');
  const dashboardSection = document.getElementById('admin-dashboard');
  const loginForm = document.getElementById('admin-login-form');
  const productForm = document.getElementById('product-form');
  const resetBtn = document.getElementById('product-reset-btn');
  const logoutBtn = document.getElementById('admin-logout');
  const alertBox = document.getElementById('admin-alert');
  const productsTableBody = document.getElementById('products-table-body');

  let adminToken = localStorage.getItem('adminToken') || null;
  let cachedApiBase;
  let apiDiscoveryPromise = null;

  const apiCandidates = Array.from(new Set([
    window.__API_BASE__,
    document.querySelector('meta[name="api-base"]')?.content,
    window.location.origin && window.location.origin !== 'null' ? window.location.origin : null,
    'http://localhost:3001',
    'http://127.0.0.1:3001'
  ].filter(Boolean).map(normalizeApiBase))).filter(Boolean);

  const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function normalizeApiBase(url) {
    if (!url) return null;
    const trimmed = String(url).trim();
    if (!trimmed) return null;
    let normalized = trimmed.replace(/\/+$/, '');
    if (/\/api$/i.test(normalized)) {
      normalized = normalized.replace(/\/api$/i, '');
    }
    return normalized;
  }

  function showAlert(message, type = 'info') {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = `admin-alert admin-alert--${type}`;
    if (message) {
      setTimeout(() => {
        alertBox.classList.add('is-visible');
      }, 10);
    } else {
      alertBox.classList.remove('is-visible');
    }
  }

  function clearAlert() {
    if (!alertBox) return;
    alertBox.textContent = '';
    alertBox.className = 'admin-alert';
  }

  function toggleSections(isLoggedIn) {
    if (isLoggedIn) {
      loginSection?.classList.add('is-hidden');
      dashboardSection?.classList.remove('is-hidden');
      logoutBtn?.classList.remove('is-hidden');
    } else {
      loginSection?.classList.remove('is-hidden');
      dashboardSection?.classList.add('is-hidden');
      logoutBtn?.classList.add('is-hidden');
    }
  }

  async function resolveApiBase() {
    if (typeof cachedApiBase === 'string' && cachedApiBase.length) {
      return cachedApiBase;
    }
    if (apiDiscoveryPromise) return apiDiscoveryPromise;
    apiDiscoveryPromise = (async () => {
      for (const candidate of apiCandidates) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const resp = await fetch(`${candidate}/api/health`, { signal: controller.signal });
          clearTimeout(timeout);
          if (resp.ok) {
            cachedApiBase = candidate;
            return candidate;
          }
        } catch (err) {
          console.warn('[Admin] Falhou ao testar API', candidate, err?.message);
        }
      }
      cachedApiBase = null;
      return null;
    })();
    try {
      return await apiDiscoveryPromise;
    } finally {
      apiDiscoveryPromise = null;
    }
  }

  async function apiRequest(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
    const base = await resolveApiBase();
    if (!base) {
      throw new Error('Backend não encontrado. Inicie o servidor (npm start).');
    }
    const finalHeaders = { ...headers };
    if (body !== undefined) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    if (auth && adminToken) {
      finalHeaders.Authorization = `Bearer ${adminToken}`;
    }
    const response = await fetch(`${base}${path}`, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (response.status === 401 && auth) {
      handleLogout(true);
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    return response;
  }

  async function uploadImageFile(file) {
    if (!file) return null;
    const base = await resolveApiBase();
    if (!base) {
      throw new Error('Backend não encontrado. Inicie o servidor (npm start).');
    }
    const formData = new FormData();
    formData.append('image', file);
    const headers = {};
    if (adminToken) {
      headers.Authorization = `Bearer ${adminToken}`;
    }
    const response = await fetch(`${base}/api/uploads/image`, {
      method: 'POST',
      headers,
      body: formData
    });
    if (response.status === 401) {
      handleLogout(true);
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (!response.ok) {
      const data = await safeJson(response);
      throw new Error(data?.error || 'Falha ao enviar imagem');
    }
    const data = await response.json();
    return data?.path || data?.url;
  }

  async function login(email, password) {
    const response = await apiRequest('/api/admin/login', {
      method: 'POST',
      body: { email, password },
      auth: false
    });
    if (!response.ok) {
      const data = await safeJson(response);
      throw new Error(data?.error || 'Não foi possível entrar');
    }
    const data = await response.json();
    adminToken = data.token;
    localStorage.setItem('adminToken', adminToken);
    toggleSections(true);
    showAlert(`Bem-vindo, ${data?.user?.name || 'admin'}!`, 'success');
    await loadProducts();
  }

  function handleLogout(silent = false) {
    adminToken = null;
    localStorage.removeItem('adminToken');
    toggleSections(false);
    if (!silent) {
      showAlert('Sessão encerrada.', 'info');
    }
  }

  function formatMoney(value) {
    if (value === null || value === undefined) return '-';
    const number = Number(value);
    if (Number.isNaN(number)) return '-';
    return moneyFormatter.format(number);
  }

  async function loadProducts() {
    if (!productsTableBody) return;
    productsTableBody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">Carregando dados...</td></tr>`;
    try {
      const response = await apiRequest('/api/products?includeInactive=true&limit=200');
      if (!response.ok) {
        const data = await safeJson(response);
        throw new Error(data?.error || 'Falha ao buscar produtos');
      }
      const data = await response.json();
      renderProductsTable(data.products || []);
    } catch (err) {
      console.error('[Admin] Erro ao listar produtos', err);
      productsTableBody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">Falha ao carregar produtos.</td></tr>`;
      showAlert(err.message, 'error');
    }
  }

  const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function serializeProduct(product) {
    try {
      return encodeURIComponent(JSON.stringify(product));
    } catch (_) {
      return '';
    }
  }

  function deserializeProduct(encoded) {
    if (!encoded) return null;
    try {
      return JSON.parse(decodeURIComponent(encoded));
    } catch (_) {
      return null;
    }
  }

  function renderProductsTable(products) {
    if (!productsTableBody) return;
    if (!products.length) {
      productsTableBody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">Nenhum produto cadastrado.</td></tr>`;
      return;
    }
    const rows = products.map((product) => {
      const status = product.isActive ? 'Ativo' : 'Inativo';
      const promo = product.discountPrice ? formatMoney(product.discountPrice) : '-';
      const serialized = serializeProduct(product);
      return `
        <tr data-id="${product.id}" data-product="${serialized}">
          <td>
            <strong>${escapeHtml(product.name)}</strong>
            <small>${product.featured ? 'Destaque • ' : ''}${escapeHtml(product.description || '')}</small>
          </td>
          <td>${escapeHtml(product.category)}</td>
          <td>${formatMoney(product.price)}</td>
          <td>${promo}</td>
          <td>${escapeHtml(status)}</td>
          <td class="admin-table__actions">
            <button data-action="edit" data-id="${product.id}">Editar</button>
            <button data-action="discount" data-id="${product.id}" data-discount="${product.discountPrice || ''}">${product.discountPrice ? 'Atualizar oferta' : 'Criar oferta'}</button>
            <button data-action="toggle" data-id="${product.id}">${product.isActive ? 'Desativar' : 'Ativar'}</button>
            <button data-action="delete" data-id="${product.id}" class="danger">Excluir</button>
          </td>
        </tr>
      `;
    }).join('');
    productsTableBody.innerHTML = rows;
  }

  function fillFormFromProduct(product) {
    if (!productForm || !product) return;
    productForm.elements.id.value = product.id;
    productForm.elements.name.value = product.name || '';
    productForm.elements.description.value = product.description || '';
    productForm.elements.category.value = product.category || '';
    productForm.elements.price.value = product.price ?? '';
    productForm.elements.discountPrice.value = product.discountPrice ?? '';
    productForm.elements.featured.checked = Boolean(product.featured);
    productForm.elements.isActive.checked = Boolean(product.isActive);
    showAlert(`Editando: ${product.name}`, 'info');
  }

  function resetForm() {
    if (!productForm) return;
    productForm.reset();
    if (productForm.elements.id) {
      productForm.elements.id.value = '';
    }
    if (productForm.elements.imageFile) {
      productForm.elements.imageFile.value = '';
    }
    showAlert('Formulário resetado.', 'info');
  }

  async function handleSaveProduct(event) {
    event.preventDefault();
    if (!productForm) return;
    const formData = new FormData(productForm);
    const payload = {
      name: formData.get('name')?.toString().trim(),
      description: formData.get('description')?.toString().trim() || '',
      category: formData.get('category')?.toString().trim(),
      price: parseFloat(String(formData.get('price')).replace(',', '.')),
      featured: formData.get('featured') === 'on',
      isActive: formData.get('isActive') !== null,
      discountPrice: formData.get('discountPrice')
        ? parseFloat(String(formData.get('discountPrice')).replace(',', '.'))
        : null
    };

    if (!payload.name || !payload.category || Number.isNaN(payload.price)) {
      showAlert('Preencha nome, categoria e preço corretamente.', 'error');
      return;
    }

    if (payload.discountPrice !== null && payload.discountPrice >= payload.price) {
      showAlert('O preço promocional deve ser menor que o preço base.', 'error');
      return;
    }

    const imageFile = productForm.elements.imageFile?.files?.[0] || null;

    if (!imageFile) {
      showAlert('Envie uma imagem do produto.', 'error');
      return;
    }

    try {
      showAlert('Enviando imagem...', 'info');
      const uploadedPath = await uploadImageFile(imageFile);
      if (!uploadedPath) {
        showAlert('Falha ao receber o caminho da imagem enviada.', 'error');
        return;
      }
      payload.imageUrl = uploadedPath;
    } catch (err) {
      showAlert(err.message, 'error');
      return;
    }

    const productId = formData.get('id');
    const method = productId ? 'PUT' : 'POST';
    const path = productId ? `/api/products/${productId}` : '/api/products';

    try {
      const response = await apiRequest(path, { method, body: payload });
      if (!response.ok) {
        const data = await safeJson(response);
        throw new Error(data?.error || 'Falha ao salvar produto');
      }
      resetForm();
      showAlert('Produto salvo com sucesso!', 'success');
      await loadProducts();
    } catch (err) {
      console.error('[Admin] Erro ao salvar produto', err);
      showAlert(err.message, 'error');
    }
  }

  async function handleDiscount(productId, currentValue) {
    const input = prompt('Informe o novo valor promocional (deixe vazio para remover)', currentValue || '');
    if (input === null) return;
    let value = input.trim();
    if (value === '') {
      value = null;
    } else {
      value = parseFloat(value.replace(',', '.'));
      if (Number.isNaN(value) || value <= 0) {
        showAlert('Valor promocional inválido.', 'error');
        return;
      }
    }
    try {
      const response = await apiRequest(`/api/products/${productId}/discount`, {
        method: 'PATCH',
        body: { discountPrice: value }
      });
      if (!response.ok) {
        const data = await safeJson(response);
        throw new Error(data?.error || 'Não foi possível atualizar a oferta');
      }
      showAlert('Oferta atualizada!', 'success');
      await loadProducts();
    } catch (err) {
      showAlert(err.message, 'error');
    }
  }

  async function handleToggle(productId) {
    try {
      const response = await apiRequest(`/api/products/${productId}/toggle`, { method: 'PATCH' });
      if (!response.ok) {
        const data = await safeJson(response);
        throw new Error(data?.error || 'Falha ao alterar status');
      }
      await loadProducts();
    } catch (err) {
      showAlert(err.message, 'error');
    }
  }

  async function handleDelete(productId) {
    if (!confirm('Tem certeza que deseja remover este produto?')) return;
    try {
      const response = await apiRequest(`/api/products/${productId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await safeJson(response);
        throw new Error(data?.error || 'Falha ao excluir produto');
      }
      showAlert('Produto removido.', 'success');
      await loadProducts();
    } catch (err) {
      showAlert(err.message, 'error');
    }
  }

  async function handleTableClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (!id || !action) return;
    const row = button.closest('tr');
    switch (action) {
      case 'edit': {
        const product = extractProductFromRow(row);
        if (!product) return;
        fillFormFromProduct(product);
        break;
      }
      case 'discount':
        await handleDiscount(id, button.dataset.discount || '');
        break;
      case 'toggle':
        await handleToggle(id);
        break;
      case 'delete':
        await handleDelete(id);
        break;
      default:
        break;
    }
  }

  function extractProductFromRow(row) {
    if (!row) return null;
    const encoded = row.dataset.product;
    const product = deserializeProduct(encoded);
    if (!product) return null;
    return product;
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();
    const formData = new FormData(loginForm);
    const email = formData.get('email')?.toString().trim();
    const password = formData.get('password')?.toString();
    if (!email || !password) {
      showAlert('Informe e-mail e senha.', 'error');
      return;
    }
    try {
      await login(email, password);
    } catch (err) {
      showAlert(err.message, 'error');
    }
  });

  productForm?.addEventListener('submit', handleSaveProduct);
  resetBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    resetForm();
  });
  productsTableBody?.addEventListener('click', (event) => {
    handleTableClick(event);
  });
  logoutBtn?.addEventListener('click', () => handleLogout(false));

  if (adminToken) {
    toggleSections(true);
    loadProducts();
  } else {
    toggleSections(false);
  }
});

