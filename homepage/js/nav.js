/**
 * Sticky nav: add a solid background once the page scrolls.
 */
(function () {
  "use strict";

  var nav = document.querySelector(".site-nav");
  if (!nav) return;

  var ticking = false;

  function update() {
    nav.classList.toggle("scrolled", window.scrollY > 40);
    ticking = false;
  }

  window.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });

  update();
})();
