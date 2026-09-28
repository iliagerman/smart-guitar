/* ===== Testimonial videos =====
   Click to play/pause. When the section scrolls into view the testimonials play
   one after another (unless the demo stage is playing). Only one sound plays at
   a time: starting a video pauses the demo and vice versa ("sg:media-play"). */
(function () {
  "use strict";

  var section = document.getElementById("testimonials");
  var videos = Array.prototype.slice.call(document.querySelectorAll(".testimonial-video-wrap video"));
  if (!videos.length) return;

  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var visible = false;
  var auto = false; // true while we're auto-advancing through the testimonials

  function buttonOf(video) {
    return video.parentNode.querySelector(".video-play-btn");
  }

  function reveal(video) {
    // On mobile the cards sit in a horizontal scroller; bring the playing one into view.
    var card = video.closest(".quote");
    var track = card && card.parentNode;
    if (!track || track.scrollWidth <= track.clientWidth) return;
    var pad = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    track.scrollTo({ left: card.offsetLeft - pad, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function play(video, fromAuto) {
    auto = !!fromAuto;
    video.muted = false;
    var p = video.play();
    if (p && p.catch) p.catch(function () { auto = false; });
    if (fromAuto) reveal(video);
  }

  function pauseAll(except) {
    videos.forEach(function (v) { if (v !== except && !v.paused) v.pause(); });
  }

  videos.forEach(function (video, i) {
    var btn = buttonOf(video);

    video.addEventListener("play", function () {
      if (btn) btn.classList.add("hidden");
      pauseAll(video);
      document.dispatchEvent(new CustomEvent("sg:media-play", { detail: { source: video } }));
    });
    video.addEventListener("pause", function () { if (btn) btn.classList.remove("hidden"); });
    video.addEventListener("ended", function () {
      if (btn) btn.classList.remove("hidden");
      if (auto && visible && i + 1 < videos.length) play(videos[i + 1], true);
      else auto = false;
    });

    function toggle(e) {
      e.stopPropagation();
      if (video.paused) play(video, false);
      else video.pause();
    }

    if (btn) btn.addEventListener("click", toggle);
    video.addEventListener("click", toggle);
  });

  document.addEventListener("sg:media-play", function (e) {
    if (!e.detail || videos.indexOf(e.detail.source) !== -1) return;
    auto = false;
    pauseAll(null);
  });

  if (section && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible = entry.isIntersecting;
        if (!visible) {
          auto = false;
          pauseAll(null);
        } else if (!document.documentElement.hasAttribute("data-demo-playing") &&
                   videos.every(function (v) { return v.paused; })) {
          play(videos[0], true);
        }
      });
    }, { threshold: 0.3 }).observe(section);
  }
})();
