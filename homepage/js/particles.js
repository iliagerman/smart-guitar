/**
 * Ember / spark particle system for the hero canvas.
 * Respects prefers-reduced-motion.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("hero-particles");
  if (!canvas) return;

  // Bail if user prefers reduced motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    canvas.style.display = "none";
    return;
  }

  const ctx = canvas.getContext("2d");
  let width, height, particles;
  let animId;

  const COLORS = [
    "rgba(249,115,22,",  // fire-500
    "rgba(251,146,60,",  // fire-400
    "rgba(234,88,12,",   // fire-600
    "rgba(253,186,116,", // fire-300
    "rgba(250,204,21,",  // flame-400
    "rgba(248,113,113,", // ember-400
  ];

  function particleCount() {
    return window.innerWidth < 640 ? 30 : 60;
  }

  function resize() {
    var w = canvas.offsetWidth || window.innerWidth;
    var h = canvas.offsetHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    width = canvas.width = w;
    height = canvas.height = h;
  }

  function createParticle() {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      x: Math.random() * width,
      y: height + Math.random() * 40,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(0.4 + Math.random() * 1.2),
      size: 1 + Math.random() * 2.5,
      alpha: 0.3 + Math.random() * 0.7,
      decay: 0.002 + Math.random() * 0.004,
      color: color,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.01 + Math.random() * 0.03,
    };
  }

  function init() {
    resize();
    const count = particleCount();
    particles = [];
    for (let i = 0; i < count; i++) {
      const p = createParticle();
      // Scatter initial positions across the screen
      p.y = Math.random() * height;
      p.alpha = Math.random() * 0.5;
      particles.push(p);
    }
  }

  function update() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * 0.3;
      p.y += p.vy;
      p.alpha -= p.decay;

      if (p.alpha <= 0 || p.y < -10) {
        particles[i] = createParticle();
      }
    }

    // Maintain particle count
    const target = particleCount();
    while (particles.length < target) {
      particles.push(createParticle());
    }
    while (particles.length > target) {
      particles.pop();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color + p.alpha.toFixed(2) + ")";
      ctx.fill();

      // Glow
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = p.color + (p.alpha * 0.15).toFixed(3) + ")";
      ctx.fill();
    }
  }

  function loop() {
    update();
    draw();
    animId = requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);

  // Pause when tab is hidden
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      cancelAnimationFrame(animId);
    } else {
      animId = requestAnimationFrame(loop);
    }
  });

  // Wait for layout to be ready so canvas has dimensions
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
