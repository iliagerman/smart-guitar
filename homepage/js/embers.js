/**
 * Embers drifting up the whole page, like sparks off the burning guitar.
 * A light 2D canvas under the text; each ember glows and fades slowly (no
 * flashing). Off for reduced motion, paused when the tab is hidden.
 */
(function () {
  "use strict";
  var canvas = document.querySelector("canvas.embers");
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0;
  var h = 0;
  var embers = [];
  var COUNT = window.innerWidth < 700 ? 22 : 40;

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(e, anywhere) {
    e.x = Math.random() * w;
    e.y = anywhere ? Math.random() * h : h + 10;
    e.r = 0.8 + Math.random() * 1.8;
    e.vy = 14 + Math.random() * 30;
    e.sway = 8 + Math.random() * 18;
    e.phase = Math.random() * Math.PI * 2;
    e.life = 0;
    e.span = 5 + Math.random() * 7;
    e.hue = 22 + Math.random() * 22;
    return e;
  }

  resize();
  for (var i = 0; i < COUNT; i++) embers.push(spawn({}, true));
  window.addEventListener("resize", resize);

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < embers.length; i++) {
      var e = embers[i];
      e.life += dt;
      e.y -= e.vy * dt;
      var x = e.x + Math.sin(e.phase + e.life * 0.9) * e.sway;
      // fade in, glow, fade out over its life
      var a = Math.sin(Math.min(1, e.life / e.span) * Math.PI) * 0.75;
      if (e.life > e.span || e.y < -10) spawn(e, false);
      var g = ctx.createRadialGradient(x, e.y, 0, x, e.y, e.r * 4);
      g.addColorStop(0, "hsla(" + e.hue + ", 100%, 70%, " + a + ")");
      g.addColorStop(1, "hsla(" + e.hue + ", 100%, 50%, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, e.y, e.r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!document.hidden) requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  });
  requestAnimationFrame(frame);
})();
