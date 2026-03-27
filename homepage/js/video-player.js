/* ===== Video Player: Autoplay on Scroll + Sequential Testimonials ===== */
(function () {
  "use strict";

  // --- Helpers ---
  function pauseWithButton(video) {
    if (!video.paused) video.pause();
    var wrap = video.closest(".feature-video-wrapper") || video.closest(".testimonial-video-wrap");
    if (wrap) {
      var btn = wrap.querySelector(".video-play-btn");
      if (btn) btn.classList.remove("hidden");
    }
  }

  function playWithButton(video) {
    video.play().catch(function () {});
    var wrap = video.closest(".feature-video-wrapper") || video.closest(".testimonial-video-wrap");
    if (wrap) {
      var btn = wrap.querySelector(".video-play-btn");
      if (btn) btn.classList.add("hidden");
    }
  }

  // =============================================
  // FEATURE VIDEO — autoplay with sound on scroll
  // =============================================
  var featureVideo = document.getElementById("feature-video-main");
  var featureStarted = false;

  if (featureVideo && "IntersectionObserver" in window) {
    var featureObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          if (featureVideo.paused) {
            featureVideo.muted = false;
            playWithButton(featureVideo);
            featureStarted = true;
          }
        } else {
          if (!featureVideo.paused) {
            pauseWithButton(featureVideo);
          }
        }
      });
    }, { threshold: 0.5 });

    featureObserver.observe(featureVideo);

    // Show play button when video ends
    featureVideo.addEventListener("ended", function () {
      var wrap = featureVideo.closest(".feature-video-wrapper");
      if (wrap) {
        var btn = wrap.querySelector(".video-play-btn");
        if (btn) btn.classList.remove("hidden");
      }
    });
  }

  // --- Feature video: click to toggle ---
  if (featureVideo) {
    featureVideo.style.cursor = "pointer";
    featureVideo.addEventListener("click", function () {
      if (featureVideo.paused) {
        featureVideo.muted = false;
        playWithButton(featureVideo);
      } else {
        pauseWithButton(featureVideo);
      }
    });
  }

  // --- Feature video play button ---
  var featureWrap = featureVideo ? featureVideo.closest(".feature-video-wrapper") : null;
  var featureBtn = featureWrap ? featureWrap.querySelector(".video-play-btn") : null;
  if (featureBtn && featureVideo) {
    featureBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (featureVideo.paused) {
        featureVideo.muted = false;
        playWithButton(featureVideo);
      } else {
        pauseWithButton(featureVideo);
      }
    });
  }

  // --- Scene navigation ---
  var sceneThumbs = document.querySelectorAll(".scene-thumb");

  if (featureVideo && sceneThumbs.length > 0) {
    sceneThumbs.forEach(function (thumb) {
      thumb.addEventListener("click", function () {
        var time = parseFloat(thumb.getAttribute("data-time")) || 0;
        sceneThumbs.forEach(function (t) { t.classList.remove("active"); });
        thumb.classList.add("active");
        featureVideo.currentTime = time;
        if (featureVideo.paused) {
          featureVideo.muted = false;
          playWithButton(featureVideo);
        }
      });
    });

    featureVideo.addEventListener("timeupdate", function () {
      var ct = featureVideo.currentTime;
      var active = null;
      sceneThumbs.forEach(function (t) {
        if (ct >= (parseFloat(t.getAttribute("data-time")) || 0)) active = t;
      });
      if (active && !active.classList.contains("active")) {
        sceneThumbs.forEach(function (t) { t.classList.remove("active"); });
        active.classList.add("active");
      }
    });
  }

  // =============================================
  // TESTIMONIALS — sequential autoplay on scroll
  // =============================================
  var testimonialVideos = Array.from(
    document.querySelectorAll(".testimonial-video-wrap video")
  );
  var testimonialSection = document.getElementById("testimonials");
  var currentTestimonialIndex = 0;
  var testimonialSectionVisible = false;
  var userControlled = false; // true if user manually clicked a video

  function playTestimonialAt(index) {
    if (index >= testimonialVideos.length) {
      // Loop back to first
      currentTestimonialIndex = 0;
      index = 0;
    }

    var video = testimonialVideos[index];
    if (!video) return;

    // Pause all testimonials first
    testimonialVideos.forEach(function (v) {
      if (!v.paused) v.pause();
      var wrap = v.closest(".testimonial-video-wrap");
      if (wrap) {
        var btn = wrap.querySelector(".video-play-btn");
        if (btn) btn.classList.remove("hidden");
      }
    });

    // Play this one
    video.currentTime = 0;
    video.muted = false;
    playWithButton(video);
    currentTestimonialIndex = index;
  }

  function stopAllTestimonials() {
    testimonialVideos.forEach(function (v) {
      if (!v.paused) v.pause();
      var wrap = v.closest(".testimonial-video-wrap");
      if (wrap) {
        var btn = wrap.querySelector(".video-play-btn");
        if (btn) btn.classList.remove("hidden");
      }
    });
  }

  // When a testimonial ends, play the next one (if section is still visible)
  testimonialVideos.forEach(function (video, idx) {
    video.addEventListener("ended", function () {
      if (!testimonialSectionVisible) return;
      if (userControlled) {
        // User clicked this one manually; just show the play button again
        pauseWithButton(video);
        userControlled = false;
        return;
      }
      // Auto-advance to next
      playTestimonialAt(idx + 1);
    });
  });

  // Observe testimonials section visibility
  if (testimonialSection && "IntersectionObserver" in window && testimonialVideos.length > 0) {
    var testObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          testimonialSectionVisible = true;
          userControlled = false;
          // Also pause feature video if playing
          if (featureVideo && !featureVideo.paused) {
            pauseWithButton(featureVideo);
          }
          playTestimonialAt(0);
        } else {
          testimonialSectionVisible = false;
          stopAllTestimonials();
        }
      });
    }, { threshold: 0.3 });

    testObserver.observe(testimonialSection);
  }

  // --- Testimonial play buttons: manual override ---
  testimonialVideos.forEach(function (video) {
    var wrap = video.closest(".testimonial-video-wrap");
    if (!wrap) return;
    var btn = wrap.querySelector(".video-play-btn");

    function handleClick(e) {
      e.stopPropagation();
      if (video.paused) {
        userControlled = true;
        // Pause all others
        testimonialVideos.forEach(function (v) {
          if (v !== video) pauseWithButton(v);
        });
        video.muted = false;
        playWithButton(video);
      } else {
        pauseWithButton(video);
      }
    }

    if (btn) btn.addEventListener("click", handleClick);
    video.style.cursor = "pointer";
    video.addEventListener("click", handleClick);
  });
})();
