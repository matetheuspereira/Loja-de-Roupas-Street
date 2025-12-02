document.addEventListener("DOMContentLoaded", () => {
  // Carrinho / Notificação state
  const carrinhoBtn = document.getElementById("carrinho");
  const notificacao = document.getElementById("notificacao");
  let cartCount = 0; // será carregado do storage mais abaixo

  // Only enable SPA on http/https, not on file:// to avoid fetch CORS issues
  const isHttpEnv = /^https?:$/.test(window.location.protocol);
  const API_HEALTH_TIMEOUT = 3000;
  const apiCandidates = Array.from(
    new Set(
      [
        window.__API_BASE__,
        document.querySelector('meta[name="api-base"]')?.content,
        window.location.origin && window.location.origin !== 'null' ? window.location.origin : null,
        'http://localhost:3001',
        'http://127.0.0.1:3001'
      ]
        .filter(Boolean)
        .map((candidate) => {
          const trimmed = candidate.trim().replace(/\/+$/, '');
          return /\/api$/i.test(trimmed) ? trimmed.replace(/\/api$/i, '') : trimmed;
        })
        .filter(Boolean)
    )
  );
  let apiBaseCache;
  let apiBasePromise = null;

  async function resolveApiBase() {
    if (typeof apiBaseCache === 'string' && apiBaseCache.length > 0) {
      return apiBaseCache;
    }
    if (apiBasePromise) return apiBasePromise;

    apiBasePromise = (async () => {
      for (const candidate of apiCandidates) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_HEALTH_TIMEOUT);
          const resp = await fetch(`${candidate}/api/health`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (resp.ok) {
            apiBaseCache = candidate;
            return candidate;
          }
        } catch (err) {
          console.warn('[API] Falha ao testar', candidate, err?.message);
        }
      }
      apiBaseCache = null;
      return null;
    })();

    try {
      return await apiBasePromise;
    } finally {
      apiBasePromise = null;
    }
  }

  function showNotification(message) {
    if (!notificacao) return;
    notificacao.textContent = message;
    notificacao.classList.add("show");
    setTimeout(() => {
      notificacao.classList.remove("show");
    }, 2000);
  }

  // Ensure global UI components exist (in any page)
  function ensureElement(selector, html) {
    let el = document.querySelector(selector);
    if (!el) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html.trim();
      el = wrapper.firstElementChild;
      document.body.appendChild(el);
    }
    return document.querySelector(selector);
  }

  // cart-config
  ensureElement('#cart-config', `
    <div id="cart-config" class="cart-config is-hidden" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="cart-config__sheet" role="document">
        <button class="cart-config__close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        <h3 class="cart-config__title">Selecionar opções</h3>
        <div class="cart-config__section">
          <span class="cart-config__label">Tamanho</span>
          <div class="sizes" role="radiogroup" aria-label="Tamanhos">
            <button class="size" data-size="P" aria-pressed="false">P</button>
            <button class="size" data-size="M" aria-pressed="false">M</button>
            <button class="size" data-size="G" aria-pressed="false">G</button>
            <button class="size" data-size="GG" aria-pressed="false">GG</button>
          </div>
        </div>
        <div class="cart-config__section">
          <span class="cart-config__label">Cor</span>
          <div class="colors" role="radiogroup" aria-label="Cores">
            <button class="color" title="Preto" data-color="preto" style="--dot:#000000"></button>
            <button class="color" title="Branco" data-color="branco" style="--dot:#ffffff"></button>
            <button class="color" title="Off White" data-color="offwhite" style="--dot:#f3f1e7"></button>
            <button class="color" title="Cinza" data-color="cinza" style="--dot:#7a7a7a"></button>
          </div>
        </div>
        <div class="cart-config__section qty">
          <span class="cart-config__label">Quantidade</span>
          <div class="qty-ctrl">
            <button class="qty-btn" data-delta="-1" aria-label="Diminuir">−</button>
            <input class="qty-input" type="number" min="1" value="1" inputmode="numeric" pattern="[0-9]*" aria-label="Quantidade" />
            <button class="qty-btn" data-delta="1" aria-label="Aumentar">+</button>
          </div>
        </div>
        <button class="cart-config__confirm">Adicionar ao carrinho</button>
      </div>
    </div>`);

  // cart badge
  ensureElement('#cart-badge', '<span id="cart-badge" class="cart-badge" aria-hidden="true"></span>');
  // cart drawer
  ensureElement('#cart-drawer', `
    <aside id="cart-drawer" class="cart-drawer" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="cart-drawer__overlay" data-close></div>
      <div class="cart-drawer__panel" role="document">
        <header class="cart-drawer__header">
          <h3>Seu carrinho</h3>
          <button class="cart-drawer__close" aria-label="Fechar" data-close><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="cart-drawer__content">
          <ul class="cart-drawer__list" id="cart-list"></ul>
        </div>
        <footer class="cart-drawer__footer">
          <div class="cart-drawer__total"><span>Total</span><strong id="cart-total">R$ 0,00</strong></div>
          <button id="cart-checkout" class="cart-drawer__checkout">Comprar</button>
        </footer>
      </div>
    </aside>`);

  const cartBadge = document.getElementById("cart-badge");
  const cartDrawer = document.getElementById("cart-drawer");
  const cartList = document.getElementById("cart-list");
  const cartTotalEl = document.getElementById("cart-total");
  const cartCheckoutBtn = document.getElementById("cart-checkout");

  // Cart state with persistence
  let cartItems = []; // {id, title, price, image, size, color, qty}

  function saveCart() {
    try { localStorage.setItem('cartItems', JSON.stringify(cartItems)); } catch {}
  }
  function loadCart() {
    try {
      const raw = localStorage.getItem('cartItems');
      cartItems = raw ? JSON.parse(raw) : [];
    } catch { cartItems = []; }
    cartCount = cartItems.reduce((sum, it) => sum + (it.qty || 0), 0);
  }
  loadCart();
  // Se a página foi recarregada (F5), limpa o carrinho
  try {
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    const isReload = nav ? nav.type === 'reload' : performance.navigation && performance.navigation.type === 1;
    if (isReload) {
      cartItems = [];
      cartCount = 0;
      localStorage.removeItem('cartItems');
    }
  } catch {}

  function positionCartBadge() {
    if (!carrinhoBtn || !cartBadge) return;
    const rect = carrinhoBtn.getBoundingClientRect();
    const BADGE_SIZE = 15; // deve acompanhar o CSS
    const INSET_X = -2; // mais à esquerda
    const INSET_Y = -2; // um pouco mais para baixo
    const top = Math.max(0, rect.bottom - BADGE_SIZE - INSET_Y);
    const left = Math.max(0, rect.left + INSET_X);
    cartBadge.style.top = `${top}px`;
    cartBadge.style.left = `${left}px`;
  }

  function updateCartCountDisplay() {
    if (!carrinhoBtn || !cartBadge) return;
    carrinhoBtn.innerHTML = `<i class=\"fa-solid fa-cart-shopping\"></i>`;
    cartBadge.textContent = String(cartCount);
    if (cartCount > 0) {
      cartBadge.style.transform = 'scale(1)';
    } else {
      cartBadge.style.transform = 'scale(0)';
    }
    positionCartBadge();
  }

  function moneyBRL(value) {
    try { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch { return `R$ ${value.toFixed(2)}`; }
  }

  function parsePrice(text) {
    // pega o último número no texto (ex.: "R$ 149,90 R$ 119,90")
    const matches = text.match(/(\d+[\.\d]*,\d{2})/g);
    if (!matches) return 0;
    const last = matches[matches.length - 1].replace(/\./g, '').replace(',', '.');
    return parseFloat(last) || 0;
  }

  function renderCartDrawer() {
    if (!cartList || !cartTotalEl) return;
    cartList.innerHTML = '';
    let total = 0;
    for (const item of cartItems) {
      total += item.price * item.qty;
      const li = document.createElement('li');
      li.className = 'cart-drawer__item';
      li.innerHTML = `
        <img class="cart-drawer__thumb" src="${item.image}" alt="${item.title}">
        <div class="cart-drawer__meta">
          <strong>${item.title}</strong>
          <span>${item.size} • ${item.color.toUpperCase()} • ${item.qty}x</span>
          <span>${moneyBRL(item.price)}</span>
        </div>
        <button class="cart-drawer__remove" data-remove="${item.id}" aria-label="Remover"><i class="fa-solid fa-xmark"></i></button>
      `;
      cartList.appendChild(li);
    }
    cartTotalEl.textContent = moneyBRL(total);
  }

  function openCartDrawer() {
    if (!cartDrawer) return;
    cartDrawer.setAttribute('aria-hidden', 'false');
    renderCartDrawer();
    if (cartBadge) cartBadge.style.display = 'none';
  }

  function closeCartDrawer() {
    if (!cartDrawer) return;
    cartDrawer.setAttribute('aria-hidden', 'true');
    if (cartBadge) { cartBadge.style.display = ''; positionCartBadge(); }
  }

  // Ensure product images always render: fallback to placeholder on error
  function attachImageFallback(scope = document) {
    scope.querySelectorAll(".card img").forEach((img) => {
      img.addEventListener("error", function onErr() {
        if (img.dataset.fallbackApplied === "true") return;
        img.dataset.fallbackApplied = "true";
        img.src = "images/placeholder.svg";
      }, { once: true });
    });
  }
  function showProductsMessage(container, message) {
    if (!container) return;
    container.innerHTML = `<div class="produtos__empty">${message}</div>`;
  }

  function renderProducts(container, products) {
    if (!container) return;
    container.innerHTML = '';
    if (!products || products.length === 0) {
      showProductsMessage(container, 'Nenhum produto disponível no momento.');
      return;
    }
    const fragment = document.createDocumentFragment();
    products.forEach((product) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.productId = product.id;
      const priceBlock = product.discountPrice
        ? `<p><s>${moneyBRL(product.price)}</s> ${moneyBRL(product.finalPrice)}</p>`
        : `<p>${moneyBRL(product.finalPrice)}</p>`;
      card.innerHTML = `
        <img src="${product.imageUrl}" alt="${product.name}">
        <h3>${product.name}</h3>
        ${priceBlock}
        <button>Adicionar ao Carrinho</button>
      `;
      fragment.appendChild(card);
    });
    container.appendChild(fragment);
    attachImageFallback(container);
  }

  function updatePager(container, products, page, limit) {
    if (!container || !container.id) return;
    const pager = document.querySelector(`[data-pager-for="${container.id}"]`);
    if (!pager) return;

    const prevBtn = pager.querySelector('.pager-prev');
    const nextBtn = pager.querySelector('.pager-next');
    const labelEl = pager.querySelector('[data-page-label]');

    if (labelEl) {
      labelEl.textContent = `Página ${page}`;
    }

    if (prevBtn) {
      prevBtn.disabled = page <= 1;
    }

    if (nextBtn) {
      // Se recebemos menos itens do que o limite, não há próxima página
      const hasLimit = typeof limit === 'number' && limit > 0;
      const hasMore = hasLimit ? products.length === limit : products.length > 0;
      nextBtn.disabled = !hasMore;
    }
  }

  async function loadProductsForSection(container) {
    if (!container) return;
    const loadingText =
      container.dataset.loadingText ||
      container.querySelector('.produtos__placeholder')?.textContent?.trim() ||
      'Carregando produtos...';
    container.innerHTML = `<div class="produtos__placeholder">${loadingText}</div>`;
    container.dataset.loading = 'true';
    try {
      const base = await resolveApiBase();
      if (!base) {
        showProductsMessage(container, 'Backend indisponível. Execute o servidor (npm start).');
        return;
      }
      const params = new URLSearchParams();
      const page = parseInt(container.dataset.page || '1', 10) || 1;
      const hasLimit = container.dataset.limit && !Number.isNaN(parseInt(container.dataset.limit, 10));
      const limit = hasLimit ? parseInt(container.dataset.limit, 10) : undefined;
      const mode = (container.dataset.products || 'all').toLowerCase();
      if (mode === 'category') {
        const category = (container.dataset.category || '').toLowerCase();
        if (category) params.set('category', category);
      } else if (mode === 'discount') {
        params.set('discounted', 'true');
      } else if (mode === 'featured') {
        params.set('featured', 'true');
      }
      if (limit) {
        params.set('limit', String(limit));
      }
      if (page > 1) {
        params.set('page', String(page));
      }
      const query = params.toString();
      const url = query ? `${base}/api/products?${query}` : `${base}/api/products`;
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error('Falha ao buscar produtos');
      const data = await resp.json();
      const products = data?.products || [];
      renderProducts(container, products);

      if (container.dataset.paginate === 'true') {
        updatePager(container, products, page, limit);
      }
    } catch (error) {
      console.error('[Produtos] Erro ao carregar catálogo:', error);
      showProductsMessage(container, 'Não foi possível carregar os produtos agora.');
    } finally {
      delete container.dataset.loading;
    }
  }

  function hydrateProducts(scope = document) {
    const sections = Array.from(scope.querySelectorAll('[data-products]'));
    if (!sections.length) return;
    sections.forEach((section) => loadProductsForSection(section));
  }

  attachImageFallback();
  hydrateProducts();

  // Banner carousel
  let carouselTimer = null;
  let currentSlideIndex = 0;
  function startCarousel() {
    const slides = document.querySelectorAll(".banner .slides img");
    if (!slides || slides.length === 0) return;
    stopCarousel();
    slides.forEach((img, idx) => img.classList.toggle("active", idx === currentSlideIndex));
    carouselTimer = setInterval(() => {
      const prev = currentSlideIndex;
      currentSlideIndex = (currentSlideIndex + 1) % slides.length;
      slides[prev]?.classList.remove("active");
      slides[currentSlideIndex]?.classList.add("active");
    }, 4000);
  }
  function stopCarousel() {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  }

  // Cart Config state
  const cartConfig = document.getElementById("cart-config");
  const sheet = cartConfig ? cartConfig.querySelector(".cart-config__sheet") : null;
  const sizeBtns = cartConfig ? Array.from(cartConfig.querySelectorAll(".size")) : [];
  const colorBtns = cartConfig ? Array.from(cartConfig.querySelectorAll(".color")) : [];
  const qtyInput = cartConfig ? cartConfig.querySelector(".qty-input") : null;
  const confirmBtn = cartConfig ? cartConfig.querySelector(".cart-config__confirm") : null;
  const closeBtn = cartConfig ? cartConfig.querySelector(".cart-config__close") : null;

  function openCartConfig() {
    if (!cartConfig) return;
    cartConfig.classList.remove("is-hidden");
    cartConfig.setAttribute("aria-hidden", "false");
    // reset selection
    sizeBtns.forEach(b => b.setAttribute("aria-pressed", "false"));
    colorBtns.forEach(b => b.setAttribute("aria-pressed", "false"));
    if (qtyInput) {
      qtyInput.value = "1";
      qtyInput.setAttribute("readonly", "true");
    }
  }
  function closeCartConfig() {
    if (!cartConfig) return;
    cartConfig.classList.add("is-hidden");
    cartConfig.setAttribute("aria-hidden", "true");
  }

  function getSelection() {
    const size = sizeBtns.find(b => b.getAttribute("aria-pressed") === "true")?.dataset.size || null;
    const color = colorBtns.find(b => b.getAttribute("aria-pressed") === "true")?.dataset.color || null;
    const qty = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
    return { size, color, qty };
  }

  let lastCardEl = null;

  // Event delegation for dynamic content (add to cart buttons), drawer and SPA links
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Drawer open/close (always active)
    if (target.closest && target.closest('[data-close]')) { closeCartDrawer(); return; }
    if (target.closest && target.closest('#carrinho')) { openCartDrawer(); return; }
    // Checkout back-to-cart from contact step
    if (target.closest && target.closest('[data-back-to-cart]')) { renderCartDrawer(); return; }

    // Drawer remove item (global)
    if (target.closest && target.closest('[data-remove]')) {
      const id = target.closest('[data-remove]').getAttribute('data-remove');
      const idx = cartItems.findIndex(i => i.id === id);
      if (idx >= 0) {
        cartItems.splice(idx, 1);
        cartCount = cartItems.reduce((sum, it) => sum + it.qty, 0);
        updateCartCountDisplay();
        renderCartDrawer();
        saveCart();
      }
      return;
    }

    // Handle add-to-cart (open configurador)
    if (target.closest && target.closest(".card button")) {
      lastCardEl = target.closest(".card");
      openCartConfig();
      return;
    }

    // Cart config interactions
    if (cartConfig && !cartConfig.classList.contains("is-hidden")) {
      if (target === cartConfig) { // click backdrop
        closeCartConfig();
        return;
      }
      if (closeBtn && target.closest(".cart-config__close")) {
        closeCartConfig();
        return;
      }
      if (target.closest && target.closest('.size')) {
        const btn = target.closest('.size');
        sizeBtns.forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
        return;
      }
      if (target.closest && target.closest('.color')) {
        const btn = target.closest('.color');
        colorBtns.forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
        return;
      }
      if (target.closest && target.closest('.qty-btn')) {
        const delta = parseInt(target.closest('.qty-btn').dataset.delta || '0', 10) || 0;
        const next = Math.max(1, (parseInt(qtyInput.value || '1', 10) || 1) + delta);
        qtyInput.value = String(next);
        return;
      }
      if (confirmBtn && target.closest('.cart-config__confirm')) {
        const { size, color, qty } = getSelection();
        if (!size || !color) { showNotification("Selecione tamanho e cor."); return; }
        // get product info from last clicked card
        const card = lastCardEl || document.querySelector('.card');
        const title = card?.querySelector('h3')?.textContent?.trim() || 'Produto';
        const priceText = card?.querySelector('p')?.textContent || '';
        const price = parsePrice(priceText);
        const image = card?.querySelector('img')?.src || '';
        const id = Date.now() + Math.random().toString(36).slice(2);
        cartItems.push({ id, title, price, image, size, color, qty });
        cartCount = cartItems.reduce((sum, it) => sum + it.qty, 0);
        updateCartCountDisplay();
        showNotification("Produto adicionado ao carrinho!");
        saveCart();
        closeCartConfig();
        return;
      }

      // (remoção já tratada globalmente)
    }

    // Paginação do catálogo
    if (target.closest && target.closest('.pager-btn')) {
      const btn = target.closest('.pager-btn');
      const pager = btn.closest('[data-pager-for]');
      if (!pager) return;
      const targetId = pager.getAttribute('data-pager-for');
      const container = targetId ? document.getElementById(targetId) : null;
      if (!container) return;

      const direction = btn.dataset.direction;
      const currentPage = parseInt(container.dataset.page || '1', 10) || 1;
      let nextPage = currentPage;
      if (direction === 'next') nextPage = currentPage + 1;
      if (direction === 'prev' && currentPage > 1) nextPage = currentPage - 1;

      if (nextPage === currentPage) return;
      container.dataset.page = String(nextPage);
      loadProductsForSection(container);
      // rola suavemente o catálogo para o topo
      const rect = container.getBoundingClientRect();
      const offset = window.scrollY + rect.top - 90; // ajusta pelo header fixo
      window.scrollTo({ top: offset, behavior: 'smooth' });
      return;
    }

    if (!isHttpEnv) return; // Do not intercept links on file://

    // Intercept internal nav links for SPA
    const link = target.closest("a");
    if (link && isInternalLink(link)) {
      const targetAttr = link.getAttribute("target");
      if (targetAttr === "_blank") return; // respect new tab
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#")) return; // allow hash links
      event.preventDefault();
      navigateTo(href);
    }
  });

  function isInternalLink(anchor) {
    if (!anchor) return false;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
    try {
      const url = new URL(href, window.location.href);
      return url.origin === window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function toggleBannerForUrl(urlLike) {
    const url = new URL(urlLike, window.location.href);
    const path = url.pathname.replace(/^\/+/, "");
    const isHome = path === "" || /(^|\/)index\.html$/.test(path);
    const banner = document.querySelector(".banner");
    if (banner) {
      banner.classList.toggle("is-hidden", !isHome);
    }
    if (isHome) {
      currentSlideIndex = 0;
      startCarousel();
    } else {
      stopCarousel();
    }
  }

  async function navigateTo(href, { replace = false } = {}) {
    const url = new URL(href, window.location.href);
    const currentMain = document.querySelector("main");
    if (!currentMain) {
      window.location.href = href;
      return;
    }
    const prevHeight = currentMain.getBoundingClientRect().height;
    currentMain.style.minHeight = prevHeight + "px";
    try {
      const response = await fetch(url.href, { credentials: "same-origin" });
      const htmlText = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");
      const newMain = doc.querySelector("main");
      if (newMain) {
        currentMain.classList.add("is-fading");
        await new Promise((r) => requestAnimationFrame(r));
        currentMain.innerHTML = newMain.innerHTML;
        attachImageFallback(currentMain);
        hydrateProducts(currentMain);
        if (doc.title) document.title = doc.title;
        toggleBannerForUrl(url);
        if (replace) {
          history.replaceState({}, "", url.pathname + url.search + url.hash);
        } else {
          history.pushState({}, "", url.pathname + url.search + url.hash);
        }
        const navMobile = document.querySelector(".nav-mobile");
        if (navMobile && navMobile.classList.contains("ativo")) {
          navMobile.classList.remove("ativo");
        }
        requestAnimationFrame(() => {
          currentMain.classList.remove("is-fading");
          setTimeout(() => {
            currentMain.style.minHeight = "";
          }, 260);
        });
        updateCartCountDisplay();
      }
    } catch (error) {
      console.error("Falha ao navegar:", error);
      showNotification("Não foi possível carregar a página.");
      currentMain.style.minHeight = "";
      window.location.href = href;
    }
  }

  if (isHttpEnv) {
    window.addEventListener("popstate", () => {
      navigateTo(window.location.href, { replace: true });
    });
  }

  // reposiciona badge em scroll/resize
  window.addEventListener('resize', positionCartBadge);
  window.addEventListener('scroll', positionCartBadge, { passive: true });

  // Checkout (refatorado com voltar funcionando)
  if (cartCheckoutBtn) {
    const content = cartDrawer.querySelector('.cart-drawer__content');
    function renderCheckoutInfo() {
      if (!content) return;
      content.innerHTML = `
        <form id="checkout-form" class="checkout-form">
          <div class="field"><label for="nome">Nome completo</label><input id="nome" name="nome" required></div>
          <div class="field"><label for="telefone">Telefone</label><input id="telefone" name="telefone" required></div>
          <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required></div>
          <div class="checkout-actions">
            <button type="button" class="btn-secondary" data-back-to-cart>Voltar</button>
            <button type="submit" class="btn-primary">Prosseguir</button>
          </div>
        </form>`;
      content.querySelector('#checkout-form').addEventListener('submit', (e) => { e.preventDefault(); renderCheckoutPayment(); });
      content.addEventListener('click', (ev) => {
        const t = ev.target; if (t instanceof Element && t.closest('[data-back-to-cart]')) { ev.preventDefault(); renderCartDrawer(); }
      });
    }
   function renderCheckoutPayment() {
  if (!content) return;

  const nome = document.getElementById('nome')?.value || '';
  const telefone = document.getElementById('telefone')?.value || '';
  const email = document.getElementById('email')?.value || '';
  const checkoutInfo = { nome, telefone, email };

  content.innerHTML = `
    <div class="pay-tabs">
      <button class="pay-tab active" data-pay-tab="pix">PIX</button>
      <button class="pay-tab" data-pay-tab="card">Cartão</button>
    </div>
    <div class="pay-panel" id="pay-panel">
      <p><strong>PIX</strong></p>
      <div id="pix-area" style="display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;">
        <button id="gen-pix" class="btn-primary" style="width:auto;">Gerar QR Code PIX</button>
        <img id="pix-qr" alt="QR Code PIX" style="display:none;width:180px;height:180px;border-radius:8px;" />
        <textarea id="pix-copy" readonly style="display:none;width:100%;height:80px;border-radius:8px;padding:8px;background:transparent;color:var(--text-color);border:1px solid var(--border-color);"></textarea>
        <button id="copy-pix" class="btn-secondary" style="display:none;width:auto;">Copiar código PIX</button>
      </div>
    </div>
    <div class="checkout-actions">
      <button type="button" class="btn-secondary" data-back-to-info>Voltar</button>
      <button type="button" class="btn-primary" data-finish>Finalizar</button>
    </div>`;

  const pixHTML = content.querySelector('#pay-panel').innerHTML;

  function setTab(tab) {
    content.querySelectorAll('.pay-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.payTab === tab)
    );

    const panel = content.querySelector('#pay-panel');
    if (tab === 'pix') {
      panel.innerHTML = pixHTML;
    } else {
      panel.innerHTML = `<p><strong>Cartão</strong></p>
        <div class="checkout-form">
          <div class="field"><label>Número do cartão</label><input inputmode="numeric" placeholder="0000 0000 0000 0000"></div>
          <div class="field"><label>Nome impresso</label><input></div>
          <div class="field"><label>Validade (MM/AA)</label><input placeholder="MM/AA"></div>
          <div class="field"><label>CVV</label><input inputmode="numeric" placeholder="123"></div>
        </div>`;
    }
  }
      content.addEventListener('click', (ev) => {
        const t = ev.target; if (!(t instanceof Element)) return;
        if (t.closest('[data-pay-tab]')) setTab(t.closest('[data-pay-tab]').dataset.payTab);
        if (t.closest('[data-back-to-info]')) renderCheckoutInfo();
        if (t.closest('[data-finish]')) { showNotification('Pedido realizado (demo).'); closeCartDrawer(); }
      });

      // gerar PIX via backend
      const genBtn = content.querySelector('#gen-pix');
      if (genBtn) {
        genBtn.addEventListener('click', async () => {
          try {
            genBtn.disabled = true;
            genBtn.textContent = 'Verificando conexão...';
            
            const backendUrl = await resolveApiBase();
            if (!backendUrl) {
              console.error('[Frontend] Backend não está acessível em nenhuma URL');
              showNotification('❌ Backend não está acessível! Verifique: 1) Backend rodando (npm start) 2) Porta 3001 não bloqueada 3) Firewall');
              genBtn.disabled = false;
              genBtn.textContent = 'Gerar QR Code PIX';
              return;
            }
            
            genBtn.textContent = 'Gerando QR Code...';
            
            const total = cartItems.reduce((s, it) => s + it.price * it.qty, 0);
            const apiUrl = `${backendUrl}/api/checkout/pix`;
            
            console.log('[Frontend] Chamando API:', apiUrl);
            console.log('[Frontend] Dados:', { amount: total, payer: checkoutInfo, items: cartItems });
            
            // Criar AbortController para timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos
            
            let resp;
            try {
              resp = await fetch(apiUrl, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: total, payer: checkoutInfo, items: cartItems }),
                signal: controller.signal
              });
              clearTimeout(timeoutId);
            } catch (fetchErr) {
              clearTimeout(timeoutId);
              if (fetchErr.name === 'AbortError') {
                console.error('[Frontend] Timeout na requisição (30s)');
                showNotification('⏱️ Timeout. O backend pode estar travado. Verifique o terminal do backend.');
              } else {
                console.error('[Frontend] Erro na requisição:', fetchErr);
                showNotification('❌ Erro de conexão. Verifique se o backend está rodando em http://localhost:3001');
              }
              genBtn.disabled = false;
              genBtn.textContent = 'Gerar QR Code PIX';
              return;
            }
            
            console.log('[Frontend] Resposta recebida, status:', resp.status);
            
            if (!resp.ok) {
              const errorData = await resp.json().catch(() => ({ error: 'Erro desconhecido' }));
              console.error('[Frontend] Erro da API:', errorData);
              showNotification('Erro: ' + (errorData.error || 'Falha ao gerar PIX'));
              genBtn.disabled = false;
              genBtn.textContent = 'Gerar QR Code PIX';
              return;
            }
            
            const data = await resp.json();
            console.log('[Frontend] Dados recebidos:', data);
            
            const img = content.querySelector('#pix-qr');
            const ta = content.querySelector('#pix-copy');
            const copyBtn = content.querySelector('#copy-pix');
            
            if (data?.qr_base64) {
              img.src = `data:image/png;base64,${data.qr_base64}`;
              img.style.display = 'block';
              console.log('[Frontend] QR Code exibido');
            } else {
              console.warn('[Frontend] qr_base64 não encontrado na resposta');
            }
            
            if (data?.copy_and_paste) {
              ta.value = data.copy_and_paste;
              ta.style.display = 'block';
              copyBtn.style.display = 'inline-block';
              copyBtn.onclick = () => { 
                navigator.clipboard.writeText(ta.value); 
                showNotification('Código PIX copiado'); 
              };
            }
            
            genBtn.style.display = 'none';
            showNotification('QR Code gerado com sucesso!');
          } catch (e) { 
            console.error('[Frontend] Erro ao gerar PIX:', e);
            showNotification('Falha ao gerar PIX. Verifique se o backend está rodando (npm start)');
            genBtn.disabled = false;
            genBtn.textContent = 'Gerar QR Code PIX';
          }
        });
      }
    }
    cartCheckoutBtn.addEventListener('click', () => { renderCheckoutInfo(); });
  }

  // Initial paint of badge from persisted state
  updateCartCountDisplay();

  const menuToggle = document.querySelector(".menu-toggle");
  const navMobile = document.querySelector(".nav-mobile");
  if (menuToggle && navMobile) {
    menuToggle.addEventListener("click", () => {
      navMobile.classList.toggle("ativo");
    });
  }

  const themeToggle = document.querySelector("#theme-toggle");
  const themeIcon = themeToggle ? themeToggle.querySelector("i") : null;
  const html = document.documentElement;

  if (localStorage.getItem("theme")) {
    const savedTheme = localStorage.getItem("theme");
    html.setAttribute("data-theme", savedTheme);
    if (themeIcon) themeIcon.className = savedTheme === "light" ? "fa-solid fa-moon" : "fa-solid fa-sun";
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const currentTheme = html.getAttribute("data-theme");
      const newTheme = currentTheme === "light" ? "dark" : "light";
      html.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      if (themeIcon) themeIcon.className = newTheme === "light" ? "fa-solid fa-moon" : "fa-solid fa-sun";
    });
  }

  toggleBannerForUrl(window.location.href);
  if (isHttpEnv) {
    navigateTo(window.location.href, { replace: true });
  }
});