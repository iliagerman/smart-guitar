/**
 * Fire / burning ember effect for the hero.
 * Embers rise from the center-bottom (where the guitar flames are).
 * Respects prefers-reduced-motion.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("hero-fire");
  if (!canvas) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    canvas.style.display = "none";
    return;
  }

  var ctx = canvas.getContext("2d");
  var width = 0;
  var height = 0;
  var embers = [];
  var animId;

  var COLORS = [
    [249, 115, 22],  // fire-500 orange
    [251, 146, 60],  // fire-400
    [234, 88, 12],   // fire-600
    [253, 186, 116], // fire-300 light
    [250, 204, 21],  // flame-400 yellow
    [248, 113, 113], // ember-400 red
    [220, 38, 38],   // ember-600 deep red
  ];

  function count() {
    return window.innerWidth < 640 ? 20 : 45;
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || window.innerWidth;
    var h = rect.height || window.innerHeight;
    if (w < 1 || h < 1) return;
    width = canvas.width = w;
    height = canvas.height = h;
  }

  function create() {
    var c = COLORS[Math.floor(Math.random() * COLORS.length)];
    // Spawn from center-bottom area (where the guitar is)
    var spread = width * 0.3;
    var centerX = width / 2 + (Math.random() - 0.5) * spread;
    var startY = height * (0.35 + Math.random() * 0.25);

    return {
      x: centerX,
      y: startY,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(0.3 + Math.random() * 0.8),
      size: 0.8 + Math.random() * 2,
      life: 1,
      decay: 0.003 + Math.random() * 0.006,
      r: c[0], g: c[1], b: c[2],
      wobble: Math.random() * Math.PI * 2,
      wobbleAmp: 0.2 + Math.random() * 0.4,
      wobbleSpeed: 0.02 + Math.random() * 0.03,
    };
  }

  function init() {
    resize();
    embers = [];
    var n = count();
    for (var i = 0; i < n; i++) {
      var e = create();
      e.life = Math.random() * 0.6;
      e.y = e.y - Math.random() * height * 0.3;
      embers.push(e);
    }
  }

  function update() {
    for (var i = embers.length - 1; i >= 0; i--) {
      var e = embers[i];
      e.wobble += e.wobbleSpeed;
      e.x += e.vx + Math.sin(e.wobble) * e.wobbleAmp;
      e.y += e.vy;
      e.life -= e.decay;
      // Embers shrink as they die
      e.size *= 0.999;

      if (e.life <= 0 || e.y < 0 || e.size < 0.3) {
        embers[i] = create();
      }
    }

    var target = count();
    while (embers.length < target) embers.push(create());
    while (embers.length > target) embers.pop();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (var i = 0; i < embers.length; i++) {
      var e = embers[i];
      var alpha = e.life * 0.7;

      // Core
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + e.r + "," + e.g + "," + e.b + "," + alpha.toFixed(3) + ")";
      ctx.fill();

      // Glow halo
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size * 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + e.r + "," + e.g + "," + e.b + "," + (alpha * 0.08).toFixed(4) + ")";
      ctx.fill();
    }
  }

  function loop() {
    update();
    draw();
    animId = requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      cancelAnimationFrame(animId);
    } else {
      animId = requestAnimationFrame(loop);
    }
  });

  if (document.readyState === "complete") {
    init();
    loop();
  } else {
    window.addEventListener("load", function () {
      init();
      loop();
    });
  }
})();
