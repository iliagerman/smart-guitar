/**
 * Page motion around the 3D worlds (the worlds themselves are js/world.min.js):
 *  - ad parameters (utm_*, fbclid, gclid, ttclid) carried onto the sign-up links
 *  - headings marked [data-split] rise word by word
 *  - the scroll-progress line and the chapter track in the nav pill
 *  - the right-hand rail of chapter dots
 *  - a sticky sign-up dock on phones once the hero button is off screen
 */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;

  /* ---------- Ad parameters -> sign-up links ---------- */
  var carry = [];
  new URLSearchParams(window.location.search).forEach(function (value, key) {
    if (/^utm_|^(fbclid|gclid|ttclid)$/.test(key)) carry.push([key, value]);
  });
  if (carry.length) {
    document.querySelectorAll('a[href^="https://app.smart-guitar.com/register"]').forEach(function (a) {
      var url = new URL(a.href);
      carry.forEach(function (kv) { url.searchParams.set(kv[0], kv[1]); });
      a.href = url.toString();
    });
  }

  /* ---------- Word-by-word headings ---------- */
  function splitWords(el) {
    var index = 0;
    el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 1) { walk(child); return; }
        if (child.nodeType !== 3 || !child.textContent.trim()) return;
        var frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          var w = document.createElement("span");
          w.className = "w";
          w.setAttribute("aria-hidden", "true");
          var wi = document.createElement("span");
          wi.className = "wi";
          wi.style.setProperty("--wi", index++);
          wi.textContent = part;
          w.appendChild(wi);
          frag.appendChild(w);
        });
        node.replaceChild(frag, child);
      });
    })(el);
  }
  if (!reduce) document.querySelectorAll("[data-split]").forEach(splitWords);
  requestAnimationFrame(function () { root.classList.add("is-loaded"); });

  /* ---------- Sticky sign-up dock (phones) ---------- */
  var dock = document.querySelector(".dock");
  var heroCta = document.querySelector(".chapter--hero .cta");
  var finaleCta = document.querySelector(".finale-cta");
  if (dock && heroCta && finaleCta) {
    var heroGone = false;
    var finaleOn = false;
    var dockObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.target === heroCta) heroGone = !e.isIntersecting && e.boundingClientRect.top < 0;
        else finaleOn = e.isIntersecting;
      });
      dock.classList.toggle("is-on", heroGone && !finaleOn);
    });
    dockObserver.observe(heroCta);
    dockObserver.observe(finaleCta);
  }

  /* ---------- Chapter track: light up the world on screen ---------- */
  var ORDER = ["room", "song", "learn", "stage", "tickets"];
  var navLinks = document.querySelectorAll("[data-nav-link]");
  var current = "";
  function setChapter(key) {
    if (key === current) return;
    current = key;
    var at = ORDER.indexOf(key);
    navLinks.forEach(function (a) {
      var i = ORDER.indexOf(a.getAttribute("data-nav-link"));
      if (i === at) a.setAttribute("aria-current", "step");
      else a.removeAttribute("aria-current");
      a.classList.toggle("is-past", i < at);
    });
  }
  if (navLinks.length) {
    setChapter("room");
    var chapterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) setChapter(e.target.getAttribute("data-nav"));
      });
    }, { rootMargin: "-49% 0px -49% 0px" });
    document.querySelectorAll("[data-nav]").forEach(function (el) { chapterObserver.observe(el); });
  }

  /* ---------- Right-hand rail: a dot per chapter ---------- */
  var rail = document.querySelector(".tour-rail ol");
  if (rail) {
    var railLinks = [];
    document.querySelectorAll("[data-shot]").forEach(function (section, i) {
      if (!section.id) section.id = "chapter-" + section.getAttribute("data-shot");
      var heading = section.querySelector("h1, h2");
      var label = heading ? heading.getAttribute("aria-label") || heading.textContent.replace(/\s+/g, " ").trim() : "Chapter " + (i + 1);
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + section.id;
      a.setAttribute("aria-label", label);
      a.innerHTML = "<span></span><i></i>";
      a.firstChild.textContent = label;
      li.appendChild(a);
      rail.appendChild(li);
      railLinks.push({ section: section, link: a });
    });
    var railObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        railLinks.forEach(function (r) {
          if (r.section === e.target) r.link.setAttribute("aria-current", "location");
          else r.link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-49% 0px -49% 0px" });
    railLinks.forEach(function (r) { railObserver.observe(r.section); });
  }

  /* ---------- Scroll progress ---------- */
  var progress = document.querySelector(".nav-progress i");
  var ticking = false;
  function onScroll() {
    ticking = false;
    var max = root.scrollHeight - window.innerHeight;
    if (progress) progress.style.transform = "scaleX(" + (max > 0 ? window.scrollY / max : 0).toFixed(4) + ")";
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
})();
