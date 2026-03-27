/**
 * Scroll-reveal using IntersectionObserver.
 * Handles .reveal (generic) and .hiw-animate (how-it-works staggered).
 */
(function () {
  "use strict";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // --- Generic reveal elements ---
  var reveals = document.querySelectorAll(".reveal");

  if (reveals.length) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -20px 0px" }
    );

    reveals.forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  // --- How It Works: staggered step animation ---
  var hiwSteps = document.querySelectorAll(".hiw-animate");

  if (hiwSteps.length) {
    var hiwSection = document.getElementById("how-it-works");
    if (hiwSection) {
      var hiwTriggered = false;

      var hiwObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && !hiwTriggered) {
              hiwTriggered = true;
              // Stagger each step with a delay
              hiwSteps.forEach(function (step, i) {
                setTimeout(function () {
                  step.classList.add("visible");
                }, i * 400);
              });
              hiwObserver.unobserve(hiwSection);
            }
          });
        },
        { threshold: 0.2 }
      );

      hiwObserver.observe(hiwSection);
    }
  }

  // --- Timeline line fill on scroll (kept for backward compat) ---
  var timelineFill = document.querySelector(".timeline-line-fill");
  var timeline = document.querySelector(".timeline");

  if (timelineFill && timeline) {
    function updateTimeline() {
      var rect = timeline.getBoundingClientRect();
      var viewH = window.innerHeight;
      var scrolled = viewH - rect.top;
      var total = rect.height;
      var pct = Math.min(Math.max(scrolled / total, 0), 1);
      timelineFill.style.height = (pct * total) + "px";
    }

    window.addEventListener("scroll", updateTimeline, { passive: true });
    updateTimeline();
  }
})();
