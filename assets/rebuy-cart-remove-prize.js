/**
 * Rebuy cart drawer: intercept remove (trash) on cart items.
 * - Non-prize items: allow default Rebuy remove.
 * - Prize items: if ticket_redeem_data (token string) is missing or invalid, remove from cart immediately.
 *   If valid, POST to /apps/redeem/release with token + variantId, then remove from cart.
 */
(function () {
  const RELEASE_URL = '/apps/redeem/release';
  const STORAGE_KEY = 'ticket_redeem_data';
  const REMOVE_BUTTON_SELECTOR = '.rebuy-cart__flyout-item-remove';
  const FLYOUT_ITEM_SELECTOR = 'li.rebuy-cart__flyout-item';

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
      return exp < Math.floor(Date.now() / 1000);
    }
    const expireTime = data.expireTime || data.expire_time || (typeof data.exp === 'string' ? data.exp : null);
    if (expireTime) {
      const expiry = new Date(expireTime).getTime();
      return Number.isNaN(expiry) || Date.now() >= expiry;
    }
    return false;
  }

  /** Returns true if ticket_redeem_data in localStorage is valid (token decodes and is not expired). */
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

  /** Get token from localStorage (ticket_redeem_data stores token string only; legacy JSON .token supported). */
  function getTicketToken() {
    try {
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

  /** Returns true if the flyout list item represents a prize product (tag-prize or property _prize). */
  function isPrizeItem(li) {
    if (!li || !li.classList) return false;
    if (li.classList.contains('tag-prize')) return true;
    for (var i = 0; i < li.classList.length; i++) {
      if (li.classList[i].indexOf('property-_prize') === 0) return true;
    }
    return false;
  }

  /** Get product handle from li class "product-{handle}". */
  function getHandleFromLi(li) {
    if (!li || !li.classList) return null;
    for (var i = 0; i < li.classList.length; i++) {
      var c = li.classList[i];
      if (c.indexOf('product-') === 0) return c.slice(8);
    }
    return null;
  }

  /** Get variant title text from the flyout item (for matching when multiple variants of same product). */
  function getVariantTitleFromLi(li) {
    var el = li ? li.querySelector('.rebuy-cart__flyout-item-variant-title') : null;
    return el ? (el.textContent || '').trim() : '';
  }

  /** Find cart line item by handle and optional variant title. */
  function findCartLineItem(cart, handle, variantTitle) {
    var items = (cart && cart.items) || [];
    var byHandle = items.filter(function (item) {
      var h = (item.handle || item.product_handle || '').toLowerCase();
      return h === (handle || '').toLowerCase();
    });
    if (byHandle.length === 0) return null;
    if (byHandle.length === 1) return byHandle[0];
    if (variantTitle) {
      var vt = (variantTitle || '').toLowerCase();
      for (var i = 0; i < byHandle.length; i++) {
        var t = (byHandle[i].variant_title || byHandle[i].title || '').toLowerCase();
        if (t === vt || t.indexOf(vt) !== -1 || vt.indexOf(t) !== -1) return byHandle[i];
      }
    }
    return byHandle[0];
  }

  /** Remove line from Shopify cart by line key. */
  function removeFromCart(lineKey) {
    return fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: lineKey, quantity: 0 })
    });
  }

  /** Notify Rebuy/theme that cart changed so drawer can refresh. */
  function notifyCartChanged() {
    try {
      document.dispatchEvent(new CustomEvent('cart:refresh'));
    } catch (_) {}
  }

  var HANDLED_ATTR = 'data-rebuy-prize-remove-bound';

  function handleRemoveClick(event) {
    var button = event.target.closest(REMOVE_BUTTON_SELECTOR);
    if (!button) return;

    var li = button.closest(FLYOUT_ITEM_SELECTOR);
    if (!li) return;

    if (!isPrizeItem(li)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    var handle = getHandleFromLi(li);
    var variantTitle = getVariantTitleFromLi(li);

    (function run() {
      var loading = button.querySelector('i');
      if (loading) {
        loading.classList.remove('fa-trash');
        loading.classList.add('fa-sync-alt', 'fa-spin');
      }
      button.disabled = true;

      fetch('/cart.js', { headers: { Accept: 'application/json' } })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (cart) {
          var lineItem = findCartLineItem(cart, handle, variantTitle);
          if (!lineItem) {
            notifyCartChanged();
            if (loading) { loading.classList.remove('fa-sync-alt', 'fa-spin'); loading.classList.add('fa-trash'); }
            button.disabled = false;
            return;
          }
          var variantId = lineItem.variant_id || lineItem.id;
          var lineKey = lineItem.key;
          var valid = getTicketRedeemValid();

          if (!valid) {
            return removeFromCart(lineKey).then(function () {
              notifyCartChanged();
              if (loading) { loading.classList.remove('fa-sync-alt', 'fa-spin'); loading.classList.add('fa-trash'); }
              button.disabled = false;
            });
          }

          var token = getTicketToken();
          return removeFromCart(lineKey)
            .then(notifyCartChanged)
            .then(function () {
              if (loading) { loading.classList.remove('fa-sync-alt', 'fa-spin'); loading.classList.add('fa-trash'); }
              button.disabled = false;
            })
            .then(function () {
              fetch(RELEASE_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Requested-With': 'XMLHttpRequest',
                  Accept: 'application/json'
                },
                body: JSON.stringify({ token: token || '', variantId: variantId })
              })
                .then(function (res) {
                  return res.json().catch(function () { return {}; }).then(function (data) { return { response: res, data: data }; });
                })
                .then(function (result) {
                  var response = result.response;
                  var data = result.data;
                  if (typeof window.handleRedeemApiResponse === 'function' && window.handleRedeemApiResponse(response, data)) {
                    if (response && response.status === 401) return;
                  }
                  var success = data && (data.success === true || data.success === 'true');
                  if (!success && data && (data.message || data.error)) {
                    try { console.warn('Rebuy prize release:', data.message || data.error); } catch (_) {}
                  }
                })
                .catch(function () {});
            });
        })
        .catch(function () {
          if (loading) { loading.classList.remove('fa-sync-alt', 'fa-spin'); loading.classList.add('fa-trash'); }
          button.disabled = false;
        });
    })();
  }

  /** Bind capture-phase listener to each remove button so we run before Vue's handler. */
  function bindRemoveButtons() {
    var root = document.getElementById('rebuy-cart') || document.body;
    root.querySelectorAll(REMOVE_BUTTON_SELECTOR).forEach(function (btn) {
      if (btn.getAttribute(HANDLED_ATTR)) return;
      btn.setAttribute(HANDLED_ATTR, '1');
      btn.addEventListener('click', handleRemoveClick, true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindRemoveButtons);
  } else {
    bindRemoveButtons();
  }
  setTimeout(bindRemoveButtons, 500);
  setTimeout(bindRemoveButtons, 1500);

  var observer = new MutationObserver(function () { bindRemoveButtons(); });
  observer.observe(document.body, { childList: true, subtree: true });
})();
