/**
 * Scroll-reveal using IntersectionObserver (.reveal -> .visible).
 * Content is only hidden when the <html> element has the "js" class, and
 * everything shows at once when the visitor prefers reduced motion.
 */
(function () {
  "use strict";

  var items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduce || !("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(items, function (el) { el.classList.add("visible"); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -24px 0px" });

  Array.prototype.forEach.call(items, function (el) { observer.observe(el); });
})();
