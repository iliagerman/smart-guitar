/**
 * Sticky nav transition + mobile hamburger menu.
 */
(function () {
  "use strict";

  const nav = document.querySelector(".site-nav");
  const hamburger = document.querySelector(".hamburger");
  const mobileMenu = document.querySelector(".mobile-menu");

  // --- Sticky nav on scroll ---
  if (nav) {
    let ticking = false;

    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(function () {
          if (window.scrollY > 60) {
            nav.classList.add("scrolled");
          } else {
            nav.classList.remove("scrolled");
          }
          ticking = false;
        });
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // --- Mobile menu ---
  if (hamburger && mobileMenu) {
    hamburger.addEventListener("click", function () {
      const expanded = hamburger.getAttribute("aria-expanded") === "true";
      hamburger.setAttribute("aria-expanded", !expanded);
      mobileMenu.classList.toggle("open");
      document.body.style.overflow = expanded ? "" : "hidden";
    });

    // Close on link click
    mobileMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        hamburger.setAttribute("aria-expanded", "false");
        mobileMenu.classList.remove("open");
        document.body.style.overflow = "";
      });
    });

    // Close on Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && mobileMenu.classList.contains("open")) {
        hamburger.setAttribute("aria-expanded", "false");
        mobileMenu.classList.remove("open");
        document.body.style.overflow = "";
      }
    });
  }
})();
