import { Composition } from "remotion";
import { SmartGuitarPromo, PROMO_DURATION_IN_FRAMES, FPS } from "./SmartGuitarPromo";
import {
  SmartGuitarAd,
  AD_DURATION_IN_FRAMES,
  AD_FPS,
  AD_WIDTH,
  AD_HEIGHT,
} from "./SmartGuitarAd";
import {
  SmartGuitarTestimonialAd,
  TESTIMONIAL_DURATION_IN_FRAMES,
  TESTIMONIAL_FPS,
  TESTIMONIAL_WIDTH,
  TESTIMONIAL_HEIGHT,
} from "./SmartGuitarTestimonialAd";
import {
  SmartGuitarPromoVertical,
  VERTICAL_PROMO_DURATION,
  VERTICAL_FPS,
  VERTICAL_WIDTH,
  VERTICAL_HEIGHT,
} from "./SmartGuitarPromoVertical";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SmartGuitarPromo"
        component={SmartGuitarPromo}
        durationInFrames={PROMO_DURATION_IN_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="SmartGuitarAd"
        component={SmartGuitarAd}
        durationInFrames={AD_DURATION_IN_FRAMES}
        fps={AD_FPS}
        width={AD_WIDTH}
        height={AD_HEIGHT}
      />
      <Composition
        id="SmartGuitarPromoVertical"
        component={SmartGuitarPromoVertical}
        durationInFrames={VERTICAL_PROMO_DURATION}
        fps={VERTICAL_FPS}
        width={VERTICAL_WIDTH}
        height={VERTICAL_HEIGHT}
      />
      <Composition
        id="SmartGuitarTestimonialAd"
        component={SmartGuitarTestimonialAd}
        durationInFrames={TESTIMONIAL_DURATION_IN_FRAMES}
        fps={TESTIMONIAL_FPS}
        width={TESTIMONIAL_WIDTH}
        height={TESTIMONIAL_HEIGHT}
      />
    </>
  );
};
