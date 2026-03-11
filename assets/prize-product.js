/**
 * Prize product gating: checks localStorage ticket_redeem_data (token string only).
 * Token is a JWT; payload must have success: true, message "Ticket is valid, please select a prize.", and not be expired.
 * - Product cards with data-prize-product: unlock only when ticketType/ticket_type is "golden"; otherwise locked.
 * - PDP with data-prize-pdp-redirect: redirect to redeem page when invalid.
 */
(function () {
  const STORAGE_KEY = 'ticket_redeem_data';

  function parsePayload(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      const trimmed = raw.trim();
      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.token === 'string') return parsePayload(parsed.token);
        return parsed;
      }
      const parts = trimmed.split('.');
      if (parts.length === 3) {
        const payload = parts[1];
        const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        return decoded;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function isExpired(data) {
    const exp = data.exp != null ? Number(data.exp) : null;
    if (exp != null && !Number.isNaN(exp)) {
      const nowSec = Math.floor(Date.now() / 1000);
      return exp < nowSec;
    }
    const expireTime = data.expireTime || data.expire_time || (typeof data.exp === 'string' ? data.exp : null);
    if (expireTime) {
      const expiry = new Date(expireTime).getTime();
      return Number.isNaN(expiry) || Date.now() >= expiry;
    }
    return false;
  }

  function getTicketRedeemValid() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = parsePayload(raw);
      if (!data || typeof data !== 'object') return false;
      if (isExpired(data)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function isGoldenTicket() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = parsePayload(raw);
      if (!data || typeof data !== 'object') return false;
      const type = (data.ticketType??'').toString().toLowerCase();
      return type === 'golden';
    } catch (_) {
      return false;
    }
  }

  /**
   * Returns reservedPrizes array from decoded JWT payload (ticket_redeem_data stores token only).
   * Each item: { prizeId (variant id), status: "ACTIVE"|"DISABLED", reservationExpiresAt }.
   */
  function getReservedPrizes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw || typeof raw !== 'string') return [];
      const data = parsePayload(raw);
      if (!data || typeof data !== 'object') return [];
      const list = data.reservedPrizes ;
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function getCardVariantIds(card) {
    const idsStr = card.getAttribute('data-prize-variant-ids');
    if (!idsStr || typeof idsStr !== 'string') return [];
    return idsStr.split(',').map(function (s) { return String(s).trim(); }).filter(Boolean);
  }

  /** Returns 'disabled' | 'active' | null. null = no reserved state for this card's variants. */
  function getCardReservedState(card, reservedPrizes) {
    const variantIds = getCardVariantIds(card);
    if (variantIds.length === 0) return null;
    for (let i = 0; i < variantIds.length; i++) {
      const entry = reservedPrizes.find(function (p) {
        const id = String(p.prizeId ?? p.prize_id ?? '').trim();
        return id === variantIds[i];
      });
      if (entry) {
        const status = (entry.status || '').toString().toUpperCase();
        if (status === 'DISABLED') return 'disabled';
        if (status === 'ACTIVE') return 'active';
      }
    }
    return null;
  }

  const RED_X_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const LOCK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function getThemePrizeIcons() {
    try {
      return (typeof window !== 'undefined' && window.__themePrizeIcons) || {};
    } catch (_) {
      return {};
    }
  }

  function renderLockIconHtml() {
    var icons = getThemePrizeIcons();
    if (icons.lock) {
      return '<img src="' + icons.lock + '" alt="" width="48" height="48" class="prize-icon-img">';
    }
    return LOCK_ICON_SVG;
  }

  function renderDisabledIconHtml() {
    var icons = getThemePrizeIcons();
    if (icons.disabled) {
      return '<img src="' + icons.disabled + '" alt="" width="48" height="48" class="prize-icon-img">';
    }
    return RED_X_ICON_SVG;
  }

  function runProductCards(redeemUrl) {
    const cards = document.querySelectorAll('[data-prize-product="true"]');
    const valid = getTicketRedeemValid() && isGoldenTicket();
    const reservedPrizes = getReservedPrizes();
    const redeemUrlFinal = redeemUrl || '/pages/redeem';

    cards.forEach(function (card) {
      card.classList.remove('product-card--prize-locked', 'product-card--prize-disabled');
      const lockOverlay = card.querySelector('.product-card__prize-lock-overlay');
      const disabledOverlay = card.querySelector('.product-card__prize-disabled-overlay');
      if (lockOverlay) lockOverlay.remove();
      if (disabledOverlay) disabledOverlay.remove();

      const link = card.querySelector('.product-card__link') || card.closest('product-card-link')?.querySelector('a') || card.querySelector('a[href]');
      const state = getCardReservedState(card, reservedPrizes);

      if (!valid) {
        card.classList.add('product-card--prize-locked');
        card.querySelectorAll('slideshow-component').forEach(function (s) { s.disabled = true; });
        if (link) {
          if (!link.dataset.originalHref && link.href) link.dataset.originalHref = link.href;
          link.href = redeemUrlFinal.startsWith('/') ? window.location.origin + redeemUrlFinal : redeemUrlFinal;
        }
        const gallery = card.querySelector('.card-gallery') || card.querySelector('[class*="gallery"]') || card.querySelector('.product-card__content');
        const wrap = gallery || card;
        wrap.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.className = 'product-card__prize-lock-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<span class="product-card__prize-lock-icon" aria-hidden="true">' + renderLockIconHtml() + '</span>';
        wrap.appendChild(overlay);
        return;
      }

      if (state === 'disabled') {
        card.classList.add('product-card--prize-locked', 'product-card--prize-disabled');
        card.querySelectorAll('slideshow-component').forEach(function (s) { s.disabled = true; });
        if (link) {
          if (!link.dataset.originalHref && link.href) link.dataset.originalHref = link.href;
          link.href = redeemUrlFinal.startsWith('/') ? window.location.origin + redeemUrlFinal : redeemUrlFinal;
        }
        const gallery = card.querySelector('.card-gallery') || card.querySelector('[class*="gallery"]') || card.querySelector('.product-card__content');
        const wrap = gallery || card;
        wrap.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.className = 'product-card__prize-disabled-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<span class="product-card__prize-disabled-icon" aria-hidden="true">' + renderDisabledIconHtml() + '</span>';
        wrap.appendChild(overlay);
        return;
      }

      if (state === 'active') {
        card.classList.add('product-card--prize-locked');
        card.querySelectorAll('slideshow-component').forEach(function (s) { s.disabled = true; });
        if (link) {
          if (!link.dataset.originalHref && link.href) link.dataset.originalHref = link.href;
          link.href = redeemUrlFinal.startsWith('/') ? window.location.origin + redeemUrlFinal : redeemUrlFinal;
        }
        const gallery = card.querySelector('.card-gallery') || card.querySelector('[class*="gallery"]') || card.querySelector('.product-card__content');
        const wrap = gallery || card;
        wrap.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.className = 'product-card__prize-lock-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<span class="product-card__prize-lock-icon" aria-hidden="true">' + renderLockIconHtml() + '</span>';
        wrap.appendChild(overlay);
        return;
      }

      card.querySelectorAll('slideshow-component').forEach(function (s) {
        s.disabled = typeof s.isNested !== 'undefined' ? s.isNested : false;
      });
      if (link && link.dataset.originalHref) {
        link.href = link.dataset.originalHref;
        link.removeAttribute('data-original-href');
      }
    });
  }

  function runPdpRedirect() {
    const section = document.querySelector('[data-prize-pdp-redirect]');
    if (!section) return;
    const redeemUrl = section.getAttribute('data-redeem-url') || '/pages/redeem';
    if (!getTicketRedeemValid()) {
      const url = redeemUrl.startsWith('/') ? window.location.origin + redeemUrl : redeemUrl;
      window.location.replace(url);
    }
  }

  function getRedeemUrlFromPage() {
    const el = document.querySelector('[data-redeem-url]');
    return el ? (el.getAttribute('data-redeem-url') || '/pages/redeem') : '/pages/redeem';
  }

  function init() {
    const redeemUrl = getRedeemUrlFromPage();
    runProductCards(redeemUrl);
    runPdpRedirect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Update product cards when token is set/removed (logout, login, or manual localStorage change)
  window.addEventListener('ticketRedeemDataChange', init);
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) init();
  });

  /**
   * Returns the token string from localStorage for use in API calls (e.g. claim prize).
   * ticket_redeem_data stores only the token. Returns null if missing or invalid.
   */
  function getTicketRedeemToken() {
    try {
      if (!getTicketRedeemValid()) return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw || typeof raw !== 'string') return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed);
          if (data && typeof data.token === 'string') return data.token;
        } catch (_) {}
        return null;
      }
      return trimmed;
    } catch (_) {
      return null;
    }
  }

  window.getTicketRedeemValid = getTicketRedeemValid;
  window.getTicketRedeemToken = getTicketRedeemToken;

  /**
   * Reusable check: returns true if the prize/ticket token in localStorage is valid and not expired.
   * Use this anywhere you need to gate prize actions (add to cart, claim, etc.).
   */
  window.isPrizeTokenValid = getTicketRedeemValid;

  /**
   * Re-run product card and PDP state based on current token. Call after changing/removing
   * ticket_redeem_data in localStorage (e.g. manual clear) so prize cards update without refresh.
   */
  window.refreshPrizeProductState = init;
})();
