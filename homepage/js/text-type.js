/**
 * Typing text effect — vanilla JS version.
 * Types out phrases, pauses, deletes, then types the next one.
 */
(function () {
  "use strict";

  var el = document.getElementById("hero-typed");
  if (!el) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = el.getAttribute("data-texts").split("|")[0];
    return;
  }

  var texts = (el.getAttribute("data-texts") || "").split("|");
  if (!texts.length) return;

  var typingSpeed = 65;
  var deletingSpeed = 35;
  var pauseDuration = 2000;
  var cursorChar = "_";

  var cursor = document.createElement("span");
  cursor.className = "typed-cursor";
  cursor.textContent = cursorChar;
  el.parentNode.insertBefore(cursor, el.nextSibling);

  var textIndex = 0;
  var charIndex = 0;
  var isDeleting = false;

  function tick() {
    var current = texts[textIndex];

    if (isDeleting) {
      charIndex--;
      el.textContent = current.substring(0, charIndex);

      if (charIndex === 0) {
        isDeleting = false;
        textIndex = (textIndex + 1) % texts.length;
        setTimeout(tick, typingSpeed);
      } else {
        setTimeout(tick, deletingSpeed);
      }
    } else {
      charIndex++;
      el.textContent = current.substring(0, charIndex);

      if (charIndex === current.length) {
        isDeleting = true;
        setTimeout(tick, pauseDuration);
      } else {
        // Variable speed for natural feel
        var speed = typingSpeed + (Math.random() * 40 - 20);
        setTimeout(tick, speed);
      }
    }
  }

  // Start after a brief delay to let the hero animations settle
  setTimeout(tick, 1200);
})();
