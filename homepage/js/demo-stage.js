/**
 * Live "try it now" demo stage.
 *
 * Six stems of one clip are decoded into one AudioContext and started at the
 * same instant (sample-accurate sync), each through its own GainNode. Tapping a
 * band member mutes/unmutes it, long-press (or the S key) solos it, and muting
 * the guitar turns its seat into the "YOU" seat. The big chord display follows
 * the clip using the chord JSON (times are relative to the clip start).
 *
 * Also renders the small easy-shape chord diagrams ([data-chord-shape]) used on
 * the page. No libraries.
 */
(function () {
  "use strict";

  /* ---------- Chord diagrams (easy open shapes, low E -> high e) ---------- */
  var SHAPES = {
    Em: [0, 2, 2, 0, 0, 0],
    E: [0, 2, 2, 1, 0, 0],
    G: [3, 2, 0, 0, 0, 3],
    C: [-1, 3, 2, 0, 1, 0],
    D: [-1, -1, 0, 2, 3, 2],
    A: [-1, 0, 2, 2, 2, 0],
    Am: [-1, 0, 2, 2, 1, 0]
  };

  function chordSVG(name) {
    var f = SHAPES[name];
    if (!f) return "";
    var x = function (i) { return (5 + i * 6.8).toFixed(1); };
    var grid = "";
    var k, i;
    for (k = 1; k <= 4; k++) grid += "M5 " + (12 + k * 10) + "H39";
    for (i = 0; i < 6; i++) grid += "M" + x(i) + " 12V52";
    var marks = "";
    for (i = 0; i < 6; i++) {
      var cx = 5 + i * 6.8;
      if (f[i] < 0) {
        marks += '<path class="cd-x" d="M' + (cx - 2).toFixed(1) + " 3.5l4 4M" + (cx + 2).toFixed(1) + ' 3.5l-4 4"/>';
      } else if (f[i] === 0) {
        marks += '<circle class="cd-o" cx="' + x(i) + '" cy="5.5" r="2.2"/>';
      } else {
        marks += '<circle class="cd-dot" cx="' + x(i) + '" cy="' + (12 + (f[i] - 0.5) * 10) + '" r="3.3"/>';
      }
    }
    return '<svg viewBox="0 0 44 54" width="44" height="54" aria-hidden="true" focusable="false">' +
      '<path class="cd-grid" d="' + grid + '"/><path class="cd-nut" d="M5 12H39"/>' + marks + "</svg>";
  }

  function drawShape(node, name) {
    if (!node || node.getAttribute("data-drawn") === name) return;
    node.innerHTML = chordSVG(name);
    node.setAttribute("data-drawn", name);
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-chord-shape]"), function (n) {
    drawShape(n, n.getAttribute("data-chord-shape"));
  });

  /* ---------- Demo stage ---------- */
  var root = document.getElementById("demo");
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!root) return;
  if (!AC || !window.fetch || !window.Promise) {
    var sub0 = root.querySelector("[data-demo-sub]");
    if (sub0) sub0.textContent = "Your browser can't play the live demo.";
    return;
  }

  var STEMS = ["vocals", "guitar", "drums", "bass", "piano", "other"];
  var LABEL = { vocals: "Vocals", guitar: "Guitar", drums: "Drums", bass: "Bass", piano: "Keys", other: "Other" };
  var BASE = root.getAttribute("data-src");
  var CHORDS_URL = root.getAttribute("data-chords");
  var MASTER = 0.9;
  var ENV_STEP = 0.05; // seconds per level-meter frame
  var LONG_PRESS_MS = 450;
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  var el = {
    play: root.querySelector("[data-demo-play]"),
    chord: root.querySelector("[data-demo-chord]"),
    next: root.querySelector("[data-demo-next]"),
    shape: root.querySelector("[data-demo-shape]"),
    beats: root.querySelectorAll("[data-demo-beats] i"),
    bar: root.querySelector("[data-demo-progress]"),
    status: root.querySelector("[data-demo-status]"),
    sub: root.querySelector("[data-demo-sub]"),
    presets: root.querySelectorAll("[data-preset]"),
    members: {}
  };
  STEMS.forEach(function (s) { el.members[s] = root.querySelector('[data-stem="' + s + '"]'); });
  var defaultSub = el.sub ? el.sub.textContent : "";

  var st = { status: "idle", playing: false, wantPlay: false, everStarted: false, muted: {}, solo: null, offset: 0, startAt: 0 };
  var ctx = null, master = null, gains = {}, buffers = {}, env = {}, sources = [];
  var loopLen = 0, chords = null, fetched = null, decoding = null, raf = 0;
  var shown = { chord: -1, beat: -1 };

  /* --- data --- */
  fetch(CHORDS_URL).then(function (r) { return r.json(); }).then(function (d) {
    chords = d;
    if (!loopLen && d.clip) loopLen = d.clip.duration;
    paint(st.offset);
  }).catch(function () {});

  function prefetch() {
    if (!fetched) {
      fetched = Promise.all(STEMS.map(function (s) {
        return fetch(BASE + s + ".mp3").then(function (r) {
          if (!r.ok) throw new Error(s + " HTTP " + r.status);
          return r.arrayBuffer();
        });
      }));
      fetched.catch(function () { fetched = null; });
    }
    return fetched;
  }

  function decode(ab) {
    return new Promise(function (resolve, reject) {
      var p = ctx.decodeAudioData(ab, resolve, reject); // callback form for older Safari
      if (p && p.then) p.then(resolve, reject);
    });
  }

  function envelope(buf) {
    var d = buf.getChannelData(0);
    var hop = Math.max(1, Math.round(buf.sampleRate * ENV_STEP));
    var n = Math.ceil(d.length / hop);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var a = i * hop, b = Math.min(a + hop, d.length), sum = 0, cnt = 0;
      for (var j = a; j < b; j += 4) { sum += d[j] * d[j]; cnt++; }
      var db = 20 * Math.log10(Math.sqrt(sum / (cnt || 1)) + 1e-9);
      out[i] = Math.max(0, Math.min(1, (db + 46) / 32));
    }
    return out;
  }

  function load() {
    if (decoding) return decoding;
    setStatus("loading");
    decoding = prefetch().then(function (abs) {
      fetched = null; // decodeAudioData detaches the buffers; refetch if we ever retry
      return Promise.all(abs.map(function (ab, i) {
        return decode(ab).then(function (b) { buffers[STEMS[i]] = b; });
      }));
    }).then(function () {
      // Identical loop length for every stem keeps them locked together on every pass.
      loopLen = Math.min.apply(null, STEMS.map(function (s) { return buffers[s].duration; }));
      STEMS.forEach(function (s) { env[s] = envelope(buffers[s]); });
      setStatus("ready");
    }, function (err) {
      decoding = null;
      fetched = null;
      st.wantPlay = false;
      setStatus("error");
      throw err;
    });
    return decoding;
  }

  /* --- audio graph --- */
  function ensureContext() {
    if (ctx) return;
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* iOS 17+: play even with the silent switch on */ }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    STEMS.forEach(function (s) {
      var g = ctx.createGain();
      g.gain.value = target(s);
      g.connect(master);
      gains[s] = g;
    });
  }

  function unlock() {
    // Must run inside the tap: resume + a 1-sample silent buffer (older iOS).
    if (ctx.state !== "running" && ctx.resume) ctx.resume();
    try {
      var b = ctx.createBuffer(1, 1, ctx.sampleRate);
      var src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
  }

  function target(s) {
    if (st.solo) return s === st.solo ? 1 : 0;
    return st.muted[s] ? 0 : 1;
  }

  function applyGains() {
    if (!ctx) return;
    var t = ctx.currentTime;
    STEMS.forEach(function (s) { gains[s].gain.setTargetAtTime(target(s), t, 0.015); });
  }

  function position() {
    if (!st.playing || !loopLen) return st.offset;
    var p = Math.max(0, ctx.currentTime - st.startAt);
    return p % loopLen;
  }

  function start() {
    var now = ctx.currentTime;
    var when = now + 0.05;
    var off = st.offset % loopLen;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(MASTER, when + 0.03);
    sources = STEMS.map(function (s) {
      var src = ctx.createBufferSource();
      src.buffer = buffers[s];
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = loopLen;
      src.connect(gains[s]);
      src.start(when, off);
      return src;
    });
    st.startAt = when - off;
    st.playing = true;
    st.everStarted = true;
    document.documentElement.setAttribute("data-demo-playing", "");
    document.dispatchEvent(new CustomEvent("sg:media-play", { detail: { source: root } }));
    loop();
  }

  function stop() {
    if (!st.playing) return;
    var now = ctx.currentTime;
    st.offset = position();
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.04);
    sources.forEach(function (src) { try { src.stop(now + 0.05); } catch (e) { /* already stopped */ } });
    sources = [];
    st.playing = false;
    document.documentElement.removeAttribute("data-demo-playing");
  }

  /* --- actions --- */
  function togglePlay() {
    ensureContext();
    unlock();
    if (st.playing) { stop(); st.wantPlay = false; render(); return; }
    if (st.status === "loading") { st.wantPlay = !st.wantPlay; render(); return; }
    st.wantPlay = true;
    if (st.status === "ready") { start(); render(); return; }
    load().then(function () {
      if (st.wantPlay && !st.playing) start();
      render();
    }).catch(function () { render(); });
    render();
  }

  function autoStart() {
    // The first touch on the band also starts the music, so the change is audible.
    if (!st.everStarted && !st.playing && !st.wantPlay) togglePlay();
  }

  function toggleMember(s) {
    if (st.solo) {
      st.solo = null;
      say("Full band.");
    } else {
      st.muted[s] = !st.muted[s];
      if (s === "guitar") say(st.muted.guitar ? "Guitar muted. You're the guitarist now." : "Guitar back in.");
      else say(LABEL[s] + (st.muted[s] ? " muted." : " back in."));
    }
    applyGains();
    render();
  }

  function soloMember(s) {
    st.solo = st.solo === s ? null : s;
    say(st.solo ? LABEL[s] + " solo." : "Full band.");
    applyGains();
    render();
  }

  function applyPreset(name) {
    st.solo = null;
    st.muted = {};
    if (name === "hear") st.solo = "guitar";
    if (name === "you") st.muted.guitar = true;
    say(name === "hear" ? "Guitar alone." : name === "you" ? "Guitar muted. You're the guitarist now." : "Full band.");
    applyGains();
    render();
  }

  function currentPreset() {
    var others = STEMS.every(function (s) { return s === "guitar" || !st.muted[s]; });
    if (st.solo === "guitar") return "hear";
    if (st.solo || !others) return null;
    return st.muted.guitar ? "you" : "full";
  }

  function say(msg) {
    if (!el.status) return;
    el.status.textContent = "";
    setTimeout(function () { el.status.textContent = msg; }, 30);
  }

  function setStatus(s) {
    st.status = s;
    render();
  }

  /* --- rendering --- */
  function render() {
    var loading = st.status === "loading" && st.wantPlay;
    root.classList.toggle("is-playing", st.playing);
    root.classList.toggle("is-loading", loading);
    root.classList.toggle("is-error", st.status === "error");
    el.play.setAttribute("aria-label", loading ? "Loading the demo" : st.playing ? "Pause the demo" : "Play the Wonderwall demo");
    el.play.setAttribute("aria-busy", loading ? "true" : "false");
    if (el.sub) {
      el.sub.textContent = st.status === "error" ? "Couldn't load the demo. Tap play to try again." : defaultSub;
    }

    STEMS.forEach(function (s) {
      var b = el.members[s];
      var on = target(s) > 0;
      var you = s === "guitar" && !!st.muted.guitar && st.solo !== "guitar";
      b.classList.toggle("is-you", you);
      b.classList.toggle("is-muted", !on && !you);
      b.classList.toggle("is-solo", st.solo === s);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (s === "guitar") {
        b.querySelector(".mem-name").textContent = you ? "YOU" : "Guitar";
        b.setAttribute("aria-label", you ? "Guitar (muted, your seat)" : "Guitar");
      }
      if (!on || reduceMotion || !st.playing) b.style.setProperty("--lvl", on ? "0.35" : "0");
    });

    var p = currentPreset();
    Array.prototype.forEach.call(el.presets, function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-preset") === p ? "true" : "false");
    });

    paint(position());
  }

  function paint(pos) {
    if (!chords) return;
    var list = chords.chords;
    var t = pos;
    if (st.playing && ctx) {
      t -= ctx.outputLatency || ctx.baseLatency || 0;
      if (t < 0) t += loopLen;
    }

    var idx = 0;
    for (var i = 0; i < list.length; i++) { if (list[i].t <= t) idx = i; else break; }
    if (idx !== shown.chord) {
      shown.chord = idx;
      el.chord.textContent = list[idx].c;
      el.next.textContent = list[(idx + 1) % list.length].c;
      drawShape(el.shape, list[idx].c);
    }

    var bars = chords.bars || [];
    var beat = 0;
    if (bars.length) {
      var bi = 0;
      for (i = 0; i < bars.length; i++) { if (bars[i] <= t) bi = i; else break; }
      var barEnd = bars[bi + 1] != null ? bars[bi + 1] : bars[bi] + 240 / (chords.bpm || 120);
      beat = Math.min(3, Math.max(0, Math.floor(((t - bars[bi]) / (barEnd - bars[bi])) * 4)));
    }
    if (beat !== shown.beat) {
      shown.beat = beat;
      Array.prototype.forEach.call(el.beats, function (d, k) { d.classList.toggle("on", k <= beat); });
    }

    if (el.bar && loopLen) el.bar.style.transform = "scaleX(" + Math.min(1, pos / loopLen).toFixed(4) + ")";

    if (st.playing && !reduceMotion) {
      var fi = Math.floor(t / ENV_STEP);
      STEMS.forEach(function (s) {
        var e = env[s];
        var lvl = e && target(s) > 0 ? e[Math.min(fi, e.length - 1)] : 0;
        el.members[s].style.setProperty("--lvl", lvl.toFixed(2));
      });
    }
  }

  function loop() {
    if (raf) return;
    var frame = function () {
      raf = 0;
      if (!st.playing) return;
      paint(position());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  /* --- input --- */
  el.play.addEventListener("click", togglePlay);

  STEMS.forEach(function (s) {
    var b = el.members[s];
    var timer = 0;
    var longAt = 0;

    b.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        longAt = Date.now();
        soloMember(s);
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* ignore */ } }
      }, LONG_PRESS_MS);
    });
    b.addEventListener("pointerup", function () {
      clearTimeout(timer);
      if (longAt && Date.now() - longAt < 1500) autoStart(); // pointerup counts as a user gesture
    });
    b.addEventListener("pointercancel", function () { clearTimeout(timer); });
    b.addEventListener("pointerleave", function () { clearTimeout(timer); });
    b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) {
      if (longAt && Date.now() - longAt < 1500) { longAt = 0; e.preventDefault(); return; }
      longAt = 0;
      toggleMember(s);
      autoStart();
    });
    b.addEventListener("keydown", function (e) {
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        soloMember(s);
        autoStart();
      }
    });
  });

  Array.prototype.forEach.call(el.presets, function (btn) {
    btn.addEventListener("click", function () {
      applyPreset(btn.getAttribute("data-preset"));
      autoStart();
    });
  });

  // One sound at a time: pause when a testimonial video starts, and when the tab is hidden.
  document.addEventListener("sg:media-play", function (e) {
    if (e.detail && e.detail.source !== root && st.playing) { stop(); st.wantPlay = false; render(); }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && st.playing) { stop(); st.wantPlay = false; render(); }
  });

  // Fetch the stems (about 1.2 MB) once the page has loaded, unless the visitor asked to save data.
  function idlePrefetch() {
    var saveData = navigator.connection && navigator.connection.saveData;
    if (saveData) return;
    var go = function () { prefetch().catch(function () {}); };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 2500 });
    else setTimeout(go, 800);
  }
  if (document.readyState === "complete") idlePrefetch();
  else window.addEventListener("load", idlePrefetch);

  render();

  // Read-only hook for debugging / QA: window.sgDemo.state()
  window.sgDemo = {
    state: function () {
      return {
        status: st.status,
        playing: st.playing,
        context: ctx ? ctx.state : "none",
        position: +position().toFixed(3),
        loopLength: loopLen,
        solo: st.solo,
        chord: el.chord.textContent,
        stems: STEMS.map(function (s) {
          return {
            id: s,
            decoded: !!buffers[s],
            duration: buffers[s] ? +buffers[s].duration.toFixed(4) : null,
            target: target(s),
            gain: gains[s] ? +gains[s].gain.value.toFixed(3) : null
          };
        })
      };
    }
  };
})();
