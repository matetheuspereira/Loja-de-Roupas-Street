document.addEventListener("DOMContentLoaded", () => {
  // Carrinho / Notificação state
  const carrinhoBtn = document.getElementById("carrinho");
  const notificacao = document.getElementById("notificacao");
  let cartCount = 0;

  // Only enable SPA on http/https, not on file:// to avoid fetch CORS issues
  const isHttpEnv = /^https?:$/.test(window.location.protocol);

  function showNotification(message) {
    if (!notificacao) return;
    notificacao.textContent = message;
    notificacao.classList.add("show");
    setTimeout(() => {
      notificacao.classList.remove("show");
    }, 2000);
  }

  function updateCartCountDisplay() {
    if (!carrinhoBtn) return;
    carrinhoBtn.innerHTML = `<i class=\"fa-solid fa-cart-shopping\"></i> (${cartCount})`;
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
  attachImageFallback();

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

  // Event delegation for dynamic content (add to cart buttons) and SPA links
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Handle add-to-cart
    if (target.tagName === "BUTTON" && target.closest(".card")) {
      cartCount++;
      updateCartCountDisplay();
      showNotification("Produto adicionado ao carrinho!");
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
