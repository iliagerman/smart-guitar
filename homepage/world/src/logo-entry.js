// Landing-page entry for the animated logo. The logo itself lives in the app
// (frontend/src/lib/flame-logo.ts) so both use the same mark.
import { mountFlameLogo } from "../../../frontend/src/lib/flame-logo.ts";

document.querySelectorAll("canvas[data-flame-logo]").forEach((canvas) => {
  mountFlameLogo(canvas, { src: "assets/logo-flame.jpg" });
});
