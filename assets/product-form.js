import { Component } from '@theme/component';
import { fetchConfig, onAnimationEnd, preloadImage } from '@theme/utilities';
import { ThemeEvents, CartAddEvent, CartErrorEvent, VariantUpdateEvent } from '@theme/events';
import { cartPerformance } from '@theme/performance';
import { morph } from '@theme/morph';

export const ADD_TO_CART_TEXT_ANIMATION_DURATION = 2000;

/**
 * Escapes HTML special characters to prevent XSS in dynamic modal content.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * A custom element that manages an add to cart button.
 *
 * @typedef {object} AddToCartRefs
 * @property {HTMLButtonElement} addToCartButton - The add to cart button.
 * @extends Component<AddToCartRefs>
 */
export class AddToCartComponent extends Component {
  requiredRefs = ['addToCartButton'];

  /** @type {number | undefined} */
  #animationTimeout;

  /** @type {number | undefined} */
  #cleanupTimeout;

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('pointerenter', this.#preloadImage);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.#animationTimeout) clearTimeout(this.#animationTimeout);
    if (this.#cleanupTimeout) clearTimeout(this.#cleanupTimeout);
    this.removeEventListener('pointerenter', this.#preloadImage);
  }

  /**
   * Disables the add to cart button.
   */
  disable() {
    this.refs.addToCartButton.disabled = true;
  }

  /**
   * Enables the add to cart button.
   */
  enable() {
    this.refs.addToCartButton.disabled = false;
  }

  /**
   * Handles the click event for the add to cart button.
   * @param {MouseEvent & {target: HTMLElement}} event - The click event.
   */
  handleClick(event) {
    const form = this.closest('form');
    if (!form?.checkValidity()) return;

    // For prize products, animation runs after claim succeeds (in #doAddToCart), not on click
    if (form?.dataset.prizeProduct !== 'true') {
      this.animateAddToCart();
      const animationEnabled = this.dataset.addToCartAnimation === 'true';
      if (animationEnabled && !event.target.closest('.quick-add-modal')) {
        this.#animateFlyToCart();
      }
    }
  }

  /**
   * Triggers the add-to-cart button animation and fly-to-cart (used after prize claim succeeds).
   */
  triggerAddToCartAnimation() {
    this.animateAddToCart();
    if (this.dataset.addToCartAnimation === 'true') {
      this.#animateFlyToCart();
    }
  }

  #preloadImage = () => {
    const image = this.dataset.productVariantMedia;

    if (!image) return;

    preloadImage(image);
  };

  /**
   * Animates the fly to cart animation.
   */
  #animateFlyToCart() {
    const { addToCartButton } = this.refs;
    const cartIcon = document.querySelector('.header-actions__cart-icon');

    const image = this.dataset.productVariantMedia;

    if (!cartIcon || !addToCartButton || !image) return;

    const flyToCartElement = /** @type {FlyToCart} */ (document.createElement('fly-to-cart'));

    flyToCartElement.style.setProperty('background-image', `url(${image})`);
    flyToCartElement.source = addToCartButton;
    flyToCartElement.destination = cartIcon;

    document.body.appendChild(flyToCartElement);
  }

  /**
   * Animates the add to cart button.
   */
  animateAddToCart() {
    const { addToCartButton } = this.refs;

    if (this.#animationTimeout) clearTimeout(this.#animationTimeout);
    if (this.#cleanupTimeout) clearTimeout(this.#cleanupTimeout);

    if (!addToCartButton.classList.contains('atc-added')) {
      addToCartButton.classList.add('atc-added');
    }

    this.#animationTimeout = setTimeout(() => {
      this.#cleanupTimeout = setTimeout(() => {
        this.refs.addToCartButton.classList.remove('atc-added');
      }, 10);
    }, ADD_TO_CART_TEXT_ANIMATION_DURATION);
  }
}

if (!customElements.get('add-to-cart-component')) {
  customElements.define('add-to-cart-component', AddToCartComponent);
}

/**
 * A custom element that manages a product form.
 *
 * @typedef {object} ProductFormRefs
 * @property {HTMLInputElement} variantId - The form input for submitting the variant ID.
 * @property {AddToCartComponent | undefined} addToCartButtonContainer - The add to cart button container element.
 * @property {HTMLElement | undefined} addToCartTextError - The add to cart text error.
 * @property {HTMLElement | undefined} acceleratedCheckoutButtonContainer - The accelerated checkout button container element.
 * @property {HTMLElement} liveRegion - The live region.
 *
 * @extends Component<ProductFormRefs>
 */
class ProductFormComponent extends Component {
  requiredRefs = ['variantId', 'liveRegion'];
  #abortController = new AbortController();

  /** @type {number | undefined} */
  #timeout;

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const target = this.closest('.shopify-section, dialog, product-card');
    target?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, { signal });
    target?.addEventListener(ThemeEvents.variantSelected, this.#onVariantSelected, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
  }

  /**
   * Handles the submit event for the product form.
   *
   * @param {Event} event - The submit event.
   */
  handleSubmit(event) {
    const { addToCartTextError } = this.refs;
    // Stop default behaviour from the browser
    event.preventDefault();

    if (this.#timeout) clearTimeout(this.#timeout);

    // Check if the add to cart button is disabled and do an early return if it is
    if (this.refs.addToCartButtonContainer?.refs.addToCartButton?.getAttribute('disabled') === 'true') return;

    const form = this.querySelector('form');
    if (!form) throw new Error('Product form element missing');

    // Prize product: check token, show confirm, claim via backend, then add to cart
    if (this.dataset.prizeProduct === 'true') {
      this.#handlePrizeAddToCart(event, form, addToCartTextError);
      return;
    }

    this.#doAddToCart(event, form, addToCartTextError);
  }

  /**
   * Fetches cart JSON. Uses Theme.routes.cart_url + '.js' for GET /cart.js.
   * @returns {Promise<{ items: Array<{ handle?: string, product_title?: string, title?: string, url?: string, properties?: Record<string, string> }> } | null>}
   */
  async #fetchCart() {
    const cartUrl = (typeof Theme !== 'undefined' && Theme.routes?.cart_url)
      ? Theme.routes.cart_url.replace(/\?.*$/, '').replace(/\/$/, '') + '.js'
      : '/cart.js';
    try {
      const res = await fetch(cartUrl, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  /**
   * Returns the first cart line item that is a prize (by _prize property or product tag), or null.
   * @returns {Promise<{ product_title: string } | null>}
   */
  async #getCartPrizeItem() {
    const cart = await this.#fetchCart();
    if (!cart?.items?.length) return null;
    const PRIZE_TAG = 'Prize';
    for (const item of cart.items) {
      if (item.properties && (item.properties._prize === '1' || item.properties._prize === 'true')) {
        return { product_title: item.product_title || item.title || 'this item' };
      }
      const handle = item.handle || (item.url && item.url.match(/\/products\/([^/?]+)/)?.[1]);
      if (!handle) continue;
      try {
        const productUrl = `/products/${encodeURIComponent(handle)}.js`;
        const res = await fetch(productUrl, { method: 'GET', headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const product = await res.json().catch(() => null);
        const tags = product?.tags;
        const hasPrizeTag = Array.isArray(tags)
          ? tags.some((t) => String(t).toLowerCase() === PRIZE_TAG.toLowerCase())
          : String(tags || '').toLowerCase().includes(PRIZE_TAG.toLowerCase());
        if (hasPrizeTag) {
          return { product_title: item.product_title || item.title || product?.title || 'this item' };
        }
      } catch (_) {
        // skip on fetch/parse error
      }
    }
    return null;
  }

  /**
   * Prize flow: validate token → check cart for existing prize → confirm modal → claim API → add to cart on success.
   * @param {Event} event
   * @param {HTMLFormElement} form
   * @param {HTMLElement | undefined} addToCartTextError
   */
  #handlePrizeAddToCart(event, form, addToCartTextError) {
    const isPrizeTokenValid =
      typeof window.isPrizeTokenValid === 'function' ? window.isPrizeTokenValid() : false;

    if (!isPrizeTokenValid) {
      this.#showPrizeMessageModal('You need a valid ticket to claim this prize.');
      cartPerformance.measureFromEvent('add:user-action', event);
      return;
    }

    this.#getCartPrizeItem().then((prizeItem) => {
      if (prizeItem) {
        const name = escapeHtml(prizeItem.product_title);
        this.#showPrizeMessageModal(
          `Remove the "${name}" because you can only add one prize.`
        );
        cartPerformance.measureFromEvent('add:user-action', event);
        return;
      }
      this.#showPrizeConfirmModal('Claim this prize? You can only pick one.', () => {
        this.#claimPrizeAndAddToCart(event, form, addToCartTextError);
      });
    });
  }

  /**
   * Calls backend to claim prize, then adds to cart on success or shows backend message on failure.
   * @param {Event} event
   * @param {HTMLFormElement} form
   * @param {HTMLElement | undefined} addToCartTextError
   */
  async #claimPrizeAndAddToCart(event, form, addToCartTextError) {
    const token =
      typeof window.getTicketRedeemToken === 'function' ? window.getTicketRedeemToken() : null;
    if (!token) {
      this.#showPrizeMessageModal('You need a valid ticket to claim this prize.');
      cartPerformance.measureFromEvent('add:user-action', event);
      return;
    }

    const formData = new FormData(form);
    const variantId = formData.get('id');
    const productId = this.dataset.productId;

    try {
      const response = await fetch('/apps/redeem/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          token,
          product_id: productId,
          variant_id: variantId,
        }),
      });

      const data = await response.json().catch(() => ({}));
      const success = data.success === true;
      const message =
        data.message ?? (data.data && data.data.message) ?? (response.ok ? '' : 'Something went wrong.');

      if (typeof window.handleRedeemApiResponse === 'function' && window.handleRedeemApiResponse(response, data)) {
        if (response.status === 401) {
          this.#showPrizeMessageModal(message || 'Your token is invalid or expired.');
          return;
        }
        if (success) this.#doAddToCart(event, form, addToCartTextError);
        return;
      }

      if (success && data.token && typeof window.applyRedeemTokenAndSync === 'function') {
        window.applyRedeemTokenAndSync(data.token);
      }
      if (success) {
        this.#doAddToCart(event, form, addToCartTextError);
      } else {
        this.#showPrizeMessageModal(message || 'Unable to claim this prize.');
      }
    } catch (_) {
      this.#showPrizeMessageModal('Something went wrong. Please try again.');
    } finally {
      cartPerformance.measureFromEvent('add:user-action', event);
    }
  }

  /**
   * Shows a confirm dialog. Calls onConfirm when user confirms, nothing on cancel.
   * @param {string} message
   * @param {() => void} onConfirm
   */
  #showPrizeConfirmModal(message, onConfirm) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'prize-confirm-title');
    dialog.className = 'prize-claim-modal color-scheme-db578fa1-da9c-48c2-a278-c672d942f928';
    dialog.innerHTML = `
      <div class="prize-claim-modal__backdrop" data-prize-close></div>
      <div class="ticket-redeem__modal-content">
        <h3 id="prize-confirm-title" class="prize-claim-modal__title">${escapeHtml(message)}</h3>
        <div class="prize-claim-modal__actions">
          <button type="button" class="button button--secondary" data-prize-cancel>Cancel</button>
          <button type="button" class="button button--primary" data-prize-confirm>Claim</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .prize-claim-modal { position: fixed; inset: 0; width: 100%; height: 100%; border: none; padding: 0; background: transparent; }
      .prize-claim-modal::backdrop { background: rgba(0, 0, 0, 0.5); }
      .prize-claim-modal__backdrop { position: absolute; inset: 0; }
      .prize-claim-modal__content {
        position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: 90%; max-width: 24rem; padding: var(--padding-xl, 1rem);
        background: var(--color-background, #fff); color: var(--color-foreground, #111);
        border-radius: var(--style-border-radius-inputs, 8px);
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }
      .prize-claim-modal__title { margin: 0 0 1rem; font-size: 1.125rem; }
      .prize-claim-modal__actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    `;
    dialog.appendChild(style);

    const close = () => {
      dialog.close();
      dialog.remove();
    };

    dialog.querySelector('[data-prize-confirm]').addEventListener('click', () => {
      close();
      onConfirm();
    });
    dialog.querySelector('[data-prize-cancel]').addEventListener('click', close);
    dialog.querySelector('[data-prize-close]').addEventListener('click', close);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  }

  /**
   * Shows a message-only modal (e.g. error or backend message).
   * @param {string} message
   */
  #showPrizeMessageModal(message) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'prize-message-title');
    dialog.className = 'prize-claim-modal color-scheme-db578fa1-da9c-48c2-a278-c672d942f928';
    dialog.innerHTML = `
      <div class="prize-claim-modal__backdrop" data-prize-close></div>
      <div class="ticket-redeem__modal-content">
        <h3 id="prize-message-title" class="prize-claim-modal__title">${escapeHtml(message)}</h3>
        <div class="prize-claim-modal__actions">
          <button type="button" class="button button--primary" data-prize-close>OK</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .prize-claim-modal { position: fixed; inset: 0; width: 100%; height: 100%; border: none; padding: 0; background: transparent; }
      .prize-claim-modal::backdrop { background: rgba(0, 0, 0, 0.5); }
      .prize-claim-modal__backdrop { position: absolute; inset: 0; }
      .prize-claim-modal__content {
        position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: 90%; max-width: 24rem; padding: var(--padding-xl, 1rem);
        background: var(--color-background, #fff); color: var(--color-foreground, #111);
        border-radius: var(--style-border-radius-inputs, 8px);
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }
      .prize-claim-modal__title { margin: 0 0 1rem; font-size: 1.125rem; }
      .prize-claim-modal__actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    `;
    dialog.appendChild(style);

    const close = () => {
      dialog.close();
      dialog.remove();
    };

    dialog.querySelectorAll('[data-prize-close]').forEach((el) => el.addEventListener('click', close));
    dialog.querySelector('.prize-claim-modal__backdrop').addEventListener('click', close);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  }

  /**
   * Performs the actual add-to-cart request and handles response (used for normal and post-claim add).
   * @param {Event} event
   * @param {HTMLFormElement} form
   * @param {HTMLElement | undefined} addToCartTextError
   */
  #doAddToCart(event, form, addToCartTextError) {
    const formData = new FormData(form);
    if (this.dataset.prizeProduct === 'true') {
      formData.append('properties[_prize]', '1');
      const token =
        typeof window.getTicketRedeemToken === 'function' ? window.getTicketRedeemToken() : null;
      if (token) {
        formData.append('properties[_prize_token]', token);
      }
    }

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const cartItemComponentsSectionIds = [];
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        cartItemComponentsSectionIds.push(item.dataset.sectionId);
      }
    });
    formData.append('sections', cartItemComponentsSectionIds.join(','));

    const fetchCfg = fetchConfig('javascript', { body: formData });

    fetch(Theme.routes.cart_add_url, {
      ...fetchCfg,
      headers: {
        ...fetchCfg.headers,
        Accept: 'text/html',
      },
    })
      .then((response) => response.json())
      .then((response) => {
        if (response.status) {
          this.dispatchEvent(
            new CartErrorEvent(form.getAttribute('id') || '', response.message, response.description, response.errors)
          );

          if (!addToCartTextError) return;
          addToCartTextError.classList.remove('hidden');

          const textNode = addToCartTextError.childNodes[2];
          if (textNode) {
            textNode.textContent = response.message;
          } else {
            const newTextNode = document.createTextNode(response.message);
            addToCartTextError.appendChild(newTextNode);
          }

          this.#setLiveRegionText(response.message);

          this.#timeout = setTimeout(() => {
            if (!addToCartTextError) return;
            addToCartTextError.classList.add('hidden');
            this.#clearLiveRegionText();
          }, 10000);

          this.dispatchEvent(
            new CartAddEvent({}, this.id, {
              didError: true,
              source: 'product-form-component',
              itemCount: Number(formData.get('quantity')) || Number(this.dataset.quantityDefault),
              productId: this.dataset.productId,
            })
          );

          return;
        }

        const id = formData.get('id');

        if (addToCartTextError) {
          addToCartTextError.classList.add('hidden');
          addToCartTextError.removeAttribute('aria-live');
        }

        if (!id) throw new Error('Form ID is required');

        // Trigger "Added" state and fly-to-cart animation for prize products (normal products animate on click)
        if (this.dataset.prizeProduct === 'true') {
          this.refs.addToCartButtonContainer?.triggerAddToCartAnimation?.();
        }

        if (this.refs.addToCartButtonContainer?.refs.addToCartButton) {
          const addToCartButton = this.refs.addToCartButtonContainer.refs.addToCartButton;
          const addedTextElement = addToCartButton.querySelector('.add-to-cart-text--added');
          const addedText = addedTextElement?.textContent?.trim() || Theme.translations.added;

          this.#setLiveRegionText(addedText);

          setTimeout(() => {
            this.#clearLiveRegionText();
          }, 5000);
        }

        this.dispatchEvent(
          new CartAddEvent({}, id.toString(), {
            source: 'product-form-component',
            itemCount: Number(formData.get('quantity')) || Number(this.dataset.quantityDefault),
            productId: this.dataset.productId,
            sections: response.sections,
          })
        );
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        cartPerformance.measureFromEvent('add:user-action', event);
      });
  }

  /**
   * @param {*} text
   */
  #setLiveRegionText(text) {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = text;
  }

  #clearLiveRegionText() {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = '';
  }

  /**
   * @param {VariantUpdateEvent} event
   */
  #onVariantUpdate = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.detail.data.productId !== this.dataset.productId) {
      return;
    }

    const { variantId, addToCartButtonContainer } = this.refs;

    const currentAddToCartButton = addToCartButtonContainer?.refs.addToCartButton;
    const newAddToCartButton = event.detail.data.html.querySelector('[ref="addToCartButton"]');

    // Update the variant ID
    variantId.value = event.detail.resource?.id ?? '';

    if (!currentAddToCartButton && !this.refs.acceleratedCheckoutButtonContainer) return;

    // Update the button state
    if (currentAddToCartButton) {
      if (event.detail.resource == null || event.detail.resource.available == false) {
        addToCartButtonContainer.disable();
      } else {
        addToCartButtonContainer.enable();
      }

      // Update the add to cart button text and icon
      if (newAddToCartButton) {
        morph(currentAddToCartButton, newAddToCartButton);
      }
    }

    if (this.refs.acceleratedCheckoutButtonContainer) {
      if (event.detail.resource == null || event.detail.resource.available == false) {
        this.refs.acceleratedCheckoutButtonContainer?.setAttribute('hidden', 'true');
      } else {
        this.refs.acceleratedCheckoutButtonContainer?.removeAttribute('hidden');
      }
    }

    // Set the data attribute for the add to cart button to the product variant media if it exists
    if (event.detail.resource) {
      const productVariantMedia = event.detail.resource.featured_media?.preview_image?.src;
      productVariantMedia &&
        addToCartButtonContainer?.setAttribute('data-product-variant-media', productVariantMedia + '&width=100');
    }
  };

  /**
   * Disable the add to cart button while the UI is updating before #onVariantUpdate is called.
   * Accelerated checkout button is also disabled via its own event listener not exposed to the theme.
   */
  #onVariantSelected = () => {
    this.refs.addToCartButtonContainer?.disable();
  };
}

if (!customElements.get('product-form-component')) {
  customElements.define('product-form-component', ProductFormComponent);
}

class FlyToCart extends HTMLElement {
  /** @type {Element} */
  source;

  /** @type {Element} */
  destination;

  connectedCallback() {
    this.#animate();
  }

  #animate() {
    const rect = this.getBoundingClientRect();
    const sourceRect = this.source.getBoundingClientRect();
    const destinationRect = this.destination.getBoundingClientRect();

    //Define bezier curve points
    // Maybe add half of the size of the flying thingy to the x and y to make it center properly
    const offset = {
      x: rect.width / 2,
      y: rect.height / 2,
    };
    const startPoint = {
      x: sourceRect.left + sourceRect.width / 2 - offset.x,
      y: sourceRect.top + sourceRect.height / 2 - offset.y,
    };

    const endPoint = {
      x: destinationRect.left + destinationRect.width / 2 - offset.x,
      y: destinationRect.top + destinationRect.height / 2 - offset.y,
    };

    //Calculate the control points
    const controlPoint1 = { x: startPoint.x, y: startPoint.y - 200 }; // Go up 200px
    const controlPoint2 = { x: endPoint.x - 300, y: endPoint.y - 100 }; // Go left 300px and up 100px

    //Animation variables
    /** @type {number | null} */
    let startTime = null;
    const duration = 600; // 600ms

    this.style.opacity = '1';

    /**
     * Animates the flying thingy along the bezier curve.
     * @param {number} currentTime - The current time.
     */
    const animate = (currentTime) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Calculate current position along the bezier curve
      const position = bezierPoint(progress, startPoint, controlPoint1, controlPoint2, endPoint);

      //Update the position of the flying thingy
      this.style.setProperty('--x', `${position.x}px`);
      this.style.setProperty('--y', `${position.y}px`);

      // Scale down as it approaches the cart
      const scale = 1 - progress * 0.5;
      this.style.setProperty('--scale', `${scale}`);

      //Continue the animation if not finished
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        //Fade out the flying thingy
        this.style.opacity = '0';
        onAnimationEnd(this, () => this.remove());
      }
    };

    // Position the flying thingy back to the start point
    this.style.setProperty('--x', `${startPoint.x}px`);
    this.style.setProperty('--y', `${startPoint.y}px`);

    //Start the animation
    requestAnimationFrame(animate);
  }
}

/**
 * Calculates a point on a cubic Bézier curve.
 * @param {number} t - The parameter value (0 <= t <= 1).
 * @param {{x: number, y: number}} p0 - The starting point (x, y).
 * @param {{x: number, y: number}} p1 - The first control point (x, y).
 * @param {{x: number, y: number}} p2 - The second control point (x, y).
 * @param {{x: number, y: number}} p3 - The ending point (x, y).
 * @returns {{x: number, y: number}} The point on the curve.
 */
function bezierPoint(t, p0, p1, p2, p3) {
  const cX = 3 * (p1.x - p0.x);
  const bX = 3 * (p2.x - p1.x) - cX;
  const aX = p3.x - p0.x - cX - bX;

  const cY = 3 * (p1.y - p0.y);
  const bY = 3 * (p2.y - p1.y) - cY;
  const aY = p3.y - p0.y - cY - bY;

  const x = aX * Math.pow(t, 3) + bX * Math.pow(t, 2) + cX * t + p0.x;
  const y = aY * Math.pow(t, 3) + bY * Math.pow(t, 2) + cY * t + p0.y;

  return { x, y };
}

if (!customElements.get('fly-to-cart')) {
  customElements.define('fly-to-cart', FlyToCart);
}
