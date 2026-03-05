/**
 * Rebuy checkout button intercept: disables Rebuy's default checkout action.
 * If cart has a prize product, requires ticket_redeem_data in localStorage;
 * otherwise shows modal to remove the prize product(s) or enter ticket code.
 * Then sends cartToken and token (from localStorage) to /apps/redeem/pre-checkout.
 */
(function () {
  const PRE_CHECKOUT_URL = '/apps/redeem/pre-checkout';
  const REBUY_CHECKOUT_SELECTOR = '.rebuy-cart__checkout-button';
  const STORAGE_KEY = 'ticket_redeem_data';

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** Returns true if the line item is a prize product (has _prize property or product_type). */
  function isPrizeItemByProperty(item) {
    if (item.properties && (item.properties._prize === '1' || item.properties['_prize'] === '1')) return true;
    if (item.product_type === 'prize') return true;
    return false;
  }

  /** Fetch product by handle and return whether it has the "prize" tag. */
  async function productHasPrizeTag(handle) {
    if (!handle) return false;
    try {
      const res = await fetch('/products/' + encodeURIComponent(handle) + '.js', { headers: { Accept: 'application/json' } });
      if (!res.ok) return false;
      const product = await res.json().catch(() => null);
      const tags = product && Array.isArray(product.tags) ? product.tags : [];
      return tags.some(function (t) { return String(t).toLowerCase() === 'prize'; });
    } catch (_) {
      return false;
    }
  }

  /** Get all cart items that are prize products (by _prize property or "prize" tag). */
  async function getPrizeItems(cart) {
    const items = cart.items || [];
    const byProperty = items.filter(isPrizeItemByProperty);
    const needTagCheck = items.filter(function (item) { return !isPrizeItemByProperty(item); });
    if (needTagCheck.length === 0) return byProperty;
    const handles = needTagCheck.map(function (item) { return item.handle || item.product_handle; });
    const results = await Promise.all(handles.map(productHasPrizeTag));
    const byTag = needTagCheck.filter(function (_, i) { return results[i]; });
    return byProperty.concat(byTag);
  }

  /** Get product title for a cart line item. */
  function getItemTitle(item) {
    return item.product_title || item.title || 'this item';
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

  /** Whether we have any ticket data to send (used for prize gate). */
  function hasTicketRedeemData() {
    return !!getTicketToken();
  }

  function showMessageModal(message) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'rebuy-precheckout-message-title');
    dialog.className = 'rebuy-precheckout-modal';
    dialog.innerHTML = `
      <div class="rebuy-precheckout-modal__backdrop" data-rebuy-close></div>
      <div class="rebuy-precheckout-modal__content">
        <h3 id="rebuy-precheckout-message-title" class="rebuy-precheckout-modal__title">${escapeHtml(message)}</h3>
        <div class="rebuy-precheckout-modal__actions">
          <button type="button" class="button button--primary" data-rebuy-close>OK</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .rebuy-precheckout-modal { position: fixed; inset: 0; width: 100%; height: 100%; border: none; padding: 0; background: transparent; z-index: 100000; }
      .rebuy-precheckout-modal::backdrop { background: rgba(0, 0, 0, 0.5); }
      .rebuy-precheckout-modal__backdrop { position: absolute; inset: 0; }
      .rebuy-precheckout-modal__content {
        position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: 90%; max-width: 24rem; padding: var(--padding-xl, 1rem);
        background: var(--color-background, #fff); color: var(--color-foreground, #111);
        border-radius: var(--style-border-radius-inputs, 8px);
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }
      .rebuy-precheckout-modal__title { margin: 0 0 1rem; font-size: 1.125rem; white-space: pre-wrap; }
      .rebuy-precheckout-modal__actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    `;
    dialog.appendChild(style);

    const close = () => {
      dialog.close();
      dialog.remove();
    };

    dialog.querySelectorAll('[data-rebuy-close]').forEach((el) => el.addEventListener('click', close));
    dialog.querySelector('.rebuy-precheckout-modal__backdrop')?.addEventListener('click', close);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  }

  async function handleRebuyCheckoutClick(event) {
    const target = event.target.closest(REBUY_CHECKOUT_SELECTOR);
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const button = target;
    const originalDisabled = button.disabled;
    try {
      button.disabled = true;

      const cartRes = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
      if (!cartRes.ok) {
        showMessageModal('Unable to load cart. Please try again.');
        return;
      }
      const cart = await cartRes.json().catch(() => null);
      const cartToken = cart && (cart.token || cart.key);
      if (!cartToken) {
        showMessageModal('Cart is empty or unavailable.');
        return;
      }

      const prizeItems = await getPrizeItems(cart);
      const hasPrize = prizeItems.length > 0;
      const hasTicket = hasTicketRedeemData();
      const token = getTicketToken();

      if (!hasPrize) {
        window.location.href = '/checkout';
        return;
      }

      if (!hasTicket) {
        const names = prizeItems.map(getItemTitle);
        const productList = names.length === 1 ? names[0] : names.join(', ');
        const message =
          'Your cart contains a prize product. Please remove "' +
          productList +
          '" from your cart, or enter your ticket code on the redeem page to continue.';
        showMessageModal(message);
        return;
      }

      // Include the prize product variant id from the cart for the backend
      const prizeVariantId = prizeItems.length > 0
        ? (prizeItems[0].variant_id ?? prizeItems[0].id)
        : null;

      const response = await fetch(PRE_CHECKOUT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          cartToken: cartToken,
          token: token || '',
          ...(prizeVariantId != null && { prizeVariantId: prizeVariantId }),
        }),
      });

      const data = await response.json().catch(() => ({}));
      const success = data.success === true;
      const message = data.message ?? data.error ?? (data.data && data.data.message) ?? 'Checkout is not available.';

      if (typeof window.handleRedeemApiResponse === 'function' && window.handleRedeemApiResponse(response, data)) {
        if (response.status === 401) {
          showMessageModal(message || 'Your token is invalid or expired.');
          return;
        }
        if (success) {
          window.location.href = data.checkout_url || '/checkout';
          return;
        }
      }

      if (success) {
        window.location.href = data.checkout_url || '/checkout';
        return;
      }

      showMessageModal(message || 'Checkout is not available.');
    } catch (err) {
      showMessageModal('Something went wrong. Please try again.');
    } finally {
      button.disabled = originalDisabled;
    }
  }

  document.addEventListener('click', handleRebuyCheckoutClick, true);
})();
