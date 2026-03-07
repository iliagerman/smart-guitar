import { Composition } from "remotion";
import { SmartGuitarPromo, PROMO_DURATION_IN_FRAMES, FPS } from "./SmartGuitarPromo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SmartGuitarPromo"
      component={SmartGuitarPromo}
      durationInFrames={PROMO_DURATION_IN_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
