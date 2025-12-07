import { Component } from '@theme/component';
import { debounce } from '@theme/utilities';

const ANIMATION_OPTIONS = {
  duration: 500,
};

class MarqueeComponent extends Component {
  requiredRefs = ['wrapper', 'content', 'marqueeItems'];

  connectedCallback() {
    super.connectedCallback();
    requestAnimationFrame(() => this.#init());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#handleResize);
    this.removeEventListener('pointerenter', this.#slowDown);
    this.removeEventListener('pointerleave', this.#speedUp);
  }

  /**
   * Attempt multiple times because iOS Safari often reports width = 0 initially
   */
  #init(attempt = 0) {
    const { marqueeItems } = this.refs;

    if (
      attempt < 6 &&
      (marqueeItems.length === 0 ||
        marqueeItems[0].offsetWidth === 0 ||
        this.offsetWidth === 0)
    ) {
      return requestAnimationFrame(() => this.#init(attempt + 1));
    }

    this.#addRepeatedItems();
    this.#duplicateContent();
    this.#setSpeed();

    window.addEventListener('resize', this.#handleResize);
    this.addEventListener('pointerenter', this.#slowDown);
    this.addEventListener('pointerleave', this.#speedUp);
  }

  /* ---------------------------
   * Speed Controls
   * --------------------------- */

  #animation = null;

  #slowDown = debounce(() => {
    if (this.#animation) return;

    const animation = this.refs.wrapper.getAnimations()[0];
    if (!animation) return;

    this.#animation = animateValue({
      ...ANIMATION_OPTIONS,
      from: 1,
      to: 0,
      onUpdate: (value) => animation.updatePlaybackRate(value),
      onComplete: () => (this.#animation = null),
    });
  }, ANIMATION_OPTIONS.duration);

  #speedUp() {
    this.#slowDown.cancel();
    const animation = this.refs.wrapper.getAnimations()[0];

    if (!animation || animation.playbackRate === 1) return;

    const from = this.#animation?.current ?? 0;
    this.#animation?.cancel();

    this.#animation = animateValue({
      ...ANIMATION_OPTIONS,
      from,
      to: 1,
      onUpdate: (value) => animation.updatePlaybackRate(value),
      onComplete: () => (this.#animation = null),
    });
  }

  /* ---------------------------
   * Calculations
   * --------------------------- */

  get clonedContent() {
    const { content, wrapper } = this.refs;
    const lastChild = wrapper.lastElementChild;
    return content !== lastChild ? lastChild : null;
  }

  #setSpeed(value = this.#calculateSpeed()) {
    this.style.setProperty('--marquee-speed', `${value}s`);
  }

  #calculateSpeed() {
    const speedFactor = Number(this.getAttribute('data-speed-factor'));
    const { marqueeItems } = this.refs;

    const itemWidth =
      marqueeItems[0]?.offsetWidth ||
      marqueeItems[0]?.getBoundingClientRect().width ||
      1;

    const marqueeWidth =
      this.offsetWidth || this.getBoundingClientRect().width || 1;

    const count = Math.ceil(marqueeWidth / itemWidth);

    return Math.sqrt(count) * speedFactor;
  }

  #calculateNumberOfCopies() {
    const { marqueeItems } = this.refs;

    const itemWidth =
      marqueeItems[0]?.offsetWidth ||
      marqueeItems[0]?.getBoundingClientRect().width ||
      1;

    const marqueeWidth =
      this.offsetWidth || this.getBoundingClientRect().width || 1;

    return Math.max(1, Math.ceil(marqueeWidth / itemWidth));
  }

  /* ---------------------------
   * DOM Manipulation (Safari-safe)
   * --------------------------- */

  #addRepeatedItems(numberOfCopies = this.#calculateNumberOfCopies()) {
    const { content, marqueeItems } = this.refs;

    // Clean previous clones (keep only the first set)
    while (content.children.length > marqueeItems.length) {
      content.removeChild(content.lastElementChild);
    }

    const baseItem = marqueeItems[0];
    if (!baseItem) return;

    // Add copies
    for (let i = 1; i < numberOfCopies; i++) {
      const clone = baseItem.cloneNode(true);
      clone.removeAttribute('ref');
      content.appendChild(clone);
    }
  }

  #duplicateContent() {
    this.clonedContent?.remove();
    const clone = this.refs.content.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('ref');
    this.refs.wrapper.appendChild(clone);
  }

  #handleResize = debounce(() => {
    const { marqueeItems } = this.refs;

    if (!marqueeItems || marqueeItems.length === 0) return;
    if (this.offsetWidth === 0) return;

    const required = this.#calculateNumberOfCopies();
    const current = marqueeItems.length;

    if (required > current) {
      this.#addRepeatedItems(required - current);
    } else if (required < current) {
      for (let i = 0; i < current - required; i++) {
        marqueeItems[marqueeItems.length - 1]?.remove();
      }
    }

    this.#duplicateContent();
    this.#setSpeed();
    this.#restartAnimation();
  }, 250);

  #restartAnimation() {
    const animations = this.refs.wrapper.getAnimations();
    requestAnimationFrame(() =>
      animations.forEach((animation) => (animation.currentTime = 0))
    );
  }
}

/* ---------------------------
 * animateValue helper
 * --------------------------- */

function animateValue({
  from,
  to,
  duration,
  onUpdate,
  easing = (t) => t * t * (3 - 2 * t),
  onComplete,
}) {
  const startTime = performance.now();
  let cancelled = false;
  let currentValue = from;

  function animate(currentTime) {
    if (cancelled) return;

    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easing(progress);

    currentValue = from + (to - from) * easedProgress;
    onUpdate(currentValue);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else if (onComplete) {
      onComplete();
    }
  }

  requestAnimationFrame(animate);

  return {
    get current() {
      return currentValue;
    },
    cancel() {
      cancelled = true;
    },
  };
}

/* ---------------------------
 * Register custom element
 * --------------------------- */

if (!customElements.get('marquee-component')) {
  customElements.define('marquee-component', MarqueeComponent);
}
