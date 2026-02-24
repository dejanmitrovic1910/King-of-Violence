/**
 * Prize product gating: checks localStorage ticket_redeem_data (JWT or JSON).
 * Payload must have success: true, message "Ticket is valid, please select a prize.", and not be expired.
 * - Product cards with data-prize-product: unlock only when ticketType/ticket_type is "golden"; otherwise locked.
 * - PDP with data-prize-pdp-redirect: redirect to redeem page when invalid.
 */
(function () {
  const STORAGE_KEY = 'ticket_redeem_data';
  const PRIZE_MESSAGE = 'Ticket is valid, please select a prize.';

  function parsePayload(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      const trimmed = raw.trim();
      if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed);
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
      if (data.success !== true) return false;
      if (data.message !== PRIZE_MESSAGE) return false;
      if (data.ticketType == null && data.ticket_type == null) return false;
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

  function runProductCards(redeemUrl) {
    const cards = document.querySelectorAll('[data-prize-product="true"]');
    const valid = getTicketRedeemValid() && isGoldenTicket();
    if (valid) {
      cards.forEach(function (card) {
        card.classList.remove('product-card--prize-locked');
        const link = card.querySelector('.product-card__link') || card.closest('product-card-link')?.querySelector('a') || card.querySelector('a[href]');
        if (link && link.dataset.originalHref) {
          link.href = link.dataset.originalHref;
          link.removeAttribute('data-original-href');
        }
        card.querySelectorAll('slideshow-component').forEach(function (s) {
          s.disabled = typeof s.isNested !== 'undefined' ? s.isNested : false;
        });
      });
      document.querySelectorAll('.product-card__prize-lock-overlay').forEach(function (overlay) {
        overlay.remove();
      });
      return;
    }
    cards.forEach(function (card) {
      const url = card.getAttribute('data-redeem-url') || redeemUrl || '/pages/redeem';
      card.classList.add('product-card--prize-locked');
      card.querySelectorAll('slideshow-component').forEach(function (s) {
        s.disabled = true;
      });
      const link = card.querySelector('.product-card__link') || card.closest('product-card-link')?.querySelector('a') || card.querySelector('a[href]');
      if (link) {
        if (!link.dataset.originalHref && link.href) link.dataset.originalHref = link.href;
        link.href = url.startsWith('/') ? window.location.origin + url : url;
      }
      let overlay = card.querySelector('.product-card__prize-lock-overlay');
      if (!overlay) {
        const gallery = card.querySelector('.card-gallery') || card.querySelector('[class*="gallery"]') || card.querySelector('.product-card__content');
        const wrap = gallery || card;
        overlay = document.createElement('div');
        overlay.className = 'product-card__prize-lock-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<span class="product-card__prize-lock-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>';
        wrap.style.position = 'relative';
        wrap.appendChild(overlay);
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
   * Returns the raw token from localStorage for use in API calls (e.g. claim prize).
   * Returns null if missing or invalid. Use getTicketRedeemValid() to check validity first.
   * When ticket_redeem_data is JSON (token + other info), returns only the token for backend.
   */
  function getTicketRedeemToken() {
    try {
      if (!getTicketRedeemValid()) return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw || typeof raw !== 'string') return null;
      const trimmed = raw.trim();
      const data = JSON.parse(trimmed);
      const token = data.token;
      return typeof token === 'string' ? token : null;
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
