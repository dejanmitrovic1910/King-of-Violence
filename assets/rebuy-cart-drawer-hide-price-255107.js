/**
 * Rebuy cart drawer suggest widget (id = 255107): remove price from DOM.
 * Targets #rebuy-widget-255107 and removes every .rebuy-product-price element.
 */
(function () {
  var WIDGET_ID = 'rebuy-widget-255107';
  var PRICE_SELECTOR = '.rebuy-product-price';

  function removePricesInWidget() {
    var widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    widget.querySelectorAll(PRICE_SELECTOR).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function run() {
    removePricesInWidget();
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
