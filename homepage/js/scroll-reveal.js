/**
 * Scroll-reveal using IntersectionObserver.
 * Also handles the timeline line-fill animation.
 */
(function () {
  "use strict";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // --- Reveal elements ---
  const reveals = document.querySelectorAll(".reveal");

  if (reveals.length) {
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    reveals.forEach(function (el) {
      observer.observe(el);
    });
  }

  // --- Timeline line fill on scroll ---
  const timelineFill = document.querySelector(".timeline-line-fill");
  const timeline = document.querySelector(".timeline");

  if (timelineFill && timeline) {
    function updateTimeline() {
      const rect = timeline.getBoundingClientRect();
      const viewH = window.innerHeight;

      // How far the viewport has scrolled past the top of the timeline
      const scrolled = viewH - rect.top;
      const total = rect.height;
      const pct = Math.min(Math.max(scrolled / total, 0), 1);

      timelineFill.style.height = (pct * total) + "px";
    }

    window.addEventListener("scroll", updateTimeline, { passive: true });
    updateTimeline();
  }
})();
