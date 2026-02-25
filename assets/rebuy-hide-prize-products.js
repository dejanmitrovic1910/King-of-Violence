/**
 * Rebuy widgets: handle prize-tag products.
 * - In widgets 251297 and 251429: add lock overlay and disable the card (no remove).
 * - In other Rebuy widgets: remove prize product blocks from the DOM.
 */
(function () {
  var PRIZE_TAG = 'prize';
  var LOCK_WIDGET_IDS = ['251297', '251429'];
  var REDEEM_PATH = '/pages/redeem';
  var cache = Object.create(null);

  function hasPrizeTag(tags) {
    if (!Array.isArray(tags)) return false;
    return tags.some(function (t) { return String(t).toLowerCase() === PRIZE_TAG; });
  }

  function getHandleFromBlock(block) {
    var link = block.querySelector('a[href*="/products/"]');
    if (!link || !link.href) return null;
    var match = link.href.match(/\/products\/([^/?]+)/);
    return match ? match[1] : null;
  }

  function isLockWidget(block) {
    var widget = block.closest('.rebuy-widget');
    if (!widget || !widget.id) return false;
    var id = widget.id.replace('rebuy-widget-', '');
    return LOCK_WIDGET_IDS.indexOf(id) !== -1;
  }

  function productHasPrizeTag(handle) {
    if (!handle) return Promise.resolve(false);
    if (cache[handle] !== undefined) return Promise.resolve(cache[handle]);
    return fetch('/products/' + encodeURIComponent(handle) + '.js', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (product) {
        var tags = product && Array.isArray(product.tags) ? product.tags : [];
        var isPrize = hasPrizeTag(tags);
        cache[handle] = isPrize;
        return isPrize;
      })
      .catch(function () {
        cache[handle] = false;
        return false;
      });
  }

  var LOCK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function lockRebuyCard(block) {
    if (block.classList.contains('rebuy-product-block--prize-locked')) return;
    block.classList.add('rebuy-product-block--prize-locked');

    var redeemUrl = (REDEEM_PATH.startsWith('/') ? window.location.origin + REDEEM_PATH : REDEEM_PATH);

    block.querySelectorAll('a[href*="/products/"]').forEach(function (a) {
      a.setAttribute('href', redeemUrl);
      a.setAttribute('aria-disabled', 'true');
    });
    block.querySelectorAll('button').forEach(function (btn) {
      btn.setAttribute('disabled', 'disabled');
    });
    block.querySelectorAll('select').forEach(function (sel) {
      sel.setAttribute('disabled', 'disabled');
    });

    var overlay = block.querySelector('.rebuy-product-block__prize-lock-overlay');
    if (!overlay) {
      var style = window.getComputedStyle(block);
      if (style.position === 'static') block.style.position = 'relative';
      overlay = document.createElement('div');
      overlay.className = 'rebuy-product-block__prize-lock-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = '<span class="rebuy-product-block__prize-lock-icon" aria-hidden="true">' + LOCK_ICON_SVG + '</span>';
      block.appendChild(overlay);
    }
  }

  function ensureStyles() {
    if (document.getElementById('rebuy-prize-lock-styles')) return;
    var style = document.createElement('style');
    style.id = 'rebuy-prize-lock-styles';
    style.textContent =
      '.rebuy-product-block--prize-locked { pointer-events: none; cursor: not-allowed; }' +
      '.rebuy-product-block__prize-lock-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); border-radius: inherit; }' +
      '.rebuy-product-block__prize-lock-icon { color: #fff; opacity: 0.9; }' +
      '.rebuy-product-block__prize-lock-icon svg { display: block; width: 48px; height: 48px; }';
    document.head.appendChild(style);
  }

  function processBlock(block) {
    if (block.dataset.rebuyPrizeChecked === '1') return;
    var handle = getHandleFromBlock(block);
    if (!handle) return;
    block.dataset.rebuyPrizeChecked = '1';

    productHasPrizeTag(handle).then(function (isPrize) {
      if (!isPrize) return;
      if (isLockWidget(block)) {
        ensureStyles();
        lockRebuyCard(block);
      } else if (block.parentNode) {
        block.parentNode.removeChild(block);
      }
    });
  }

  function run() {
    document.querySelectorAll('.rebuy-product-block').forEach(processBlock);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  var observer = new MutationObserver(function () { run(); });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(run, 500);
  setTimeout(run, 1500);
})();
