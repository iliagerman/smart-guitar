/* ===== Showcase Carousel: Auto-cycle slides with dot navigation ===== */
(function () {
  "use strict";

  var dots = document.querySelectorAll(".showcase-dot");
  var slides = document.querySelectorAll(".showcase-slide");
  var section = document.getElementById("showcase");

  if (!dots.length || !slides.length || !section) return;

  var currentIndex = 0;
  var autoTimer = null;
  var AUTO_INTERVAL = 5000; // 5 seconds per slide
  var sectionVisible = false;

  function showSlide(index) {
    if (index === currentIndex && slides[index].classList.contains("active")) return;

    // Exit current
    var currentSlide = slides[currentIndex];
    if (currentSlide.classList.contains("active")) {
      currentSlide.classList.remove("active");
      currentSlide.classList.add("exiting");
      // Remove exiting class after animation
      (function (s) {
        setTimeout(function () { s.classList.remove("exiting"); }, 300);
      })(currentSlide);
    }

    // Activate new
    currentIndex = index;
    setTimeout(function () {
      slides[currentIndex].classList.add("active");
    }, 300);

    // Update dots
    dots.forEach(function (d) {
      d.classList.remove("active");
      d.setAttribute("aria-selected", "false");
    });
    dots[currentIndex].classList.add("active");
    dots[currentIndex].setAttribute("aria-selected", "true");
  }

  function nextSlide() {
    showSlide((currentIndex + 1) % slides.length);
  }

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(nextSlide, AUTO_INTERVAL);
  }

  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  // Dot clicks
  dots.forEach(function (dot) {
    dot.addEventListener("click", function () {
      var idx = parseInt(dot.getAttribute("data-slide"), 10);
      showSlide(idx);
      // Restart auto-timer so user gets full 5s on clicked slide
      if (sectionVisible) startAuto();
    });
  });

  // Auto-cycle when section is visible
  if ("IntersectionObserver" in window) {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          sectionVisible = true;
          startAuto();
        } else {
          sectionVisible = false;
          stopAuto();
        }
      });
    }, { threshold: 0.3 });

    obs.observe(section);
  }
})();
