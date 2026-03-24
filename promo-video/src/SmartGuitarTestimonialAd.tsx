import { AbsoluteFill, Sequence, staticFile, interpolate } from "remotion";
import { Video } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AdOverlayText } from "./scenes/AdOverlayText";
import { AdCTAScene } from "./scenes/AdCTAScene";

export const TESTIMONIAL_FPS = 30;
export const TESTIMONIAL_WIDTH = 1080;
export const TESTIMONIAL_HEIGHT = 1920;

// The pre-rendered video is 30.5s with crossfades already baked in
const VIDEO_DURATION_S = 30.5;
const VIDEO_DURATION_FRAMES = Math.round(VIDEO_DURATION_S * TESTIMONIAL_FPS); // 915 frames
const CTA_DURATION = 8 * TESTIMONIAL_FPS; // 240 frames
const XFADE = 15; // crossfade into CTA

// Total composition duration
export const TESTIMONIAL_DURATION_IN_FRAMES =
  VIDEO_DURATION_FRAMES + CTA_DURATION - XFADE;

// Scene timestamps in seconds (each ~7.5s with 0.5s crossfade overlap)
const SCENE_STARTS_S = [0, 7.5, 15, 22.5];
const OVERLAY_DURATION_S = 6; // show text for 6s per scene

// Overlay text per testimonial
const OVERLAYS = [
  {
    title: "Finally nailed the strumming pattern 🎸",
  },
  {
    title: "Stem separation changed everything 🎧",
  },
  {
    title: "My rhythm finally clicked 🥁",
  },
  {
    title: "Every song, all in one place 🎵",
  },
];

export const SmartGuitarTestimonialAd: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <TransitionSeries>
        {/* Main testimonial video with overlay annotations */}
        <TransitionSeries.Sequence durationInFrames={VIDEO_DURATION_FRAMES}>
          <AbsoluteFill>
            {/* Single pre-rendered video with all testimonials */}
            <Video
              src={staticFile("testimonial-final.mp4")}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
              volume={(f) => {
                // Fade out audio over last 2 seconds
                const fadeStart = VIDEO_DURATION_FRAMES - 2 * TESTIMONIAL_FPS;
                if (f < fadeStart) return 1;
                return Math.max(0, 1 - (f - fadeStart) / (2 * TESTIMONIAL_FPS));
              }}
            />

            {/* Text overlays timed to each testimonial */}
            {OVERLAYS.map((overlay, i) => (
              <Sequence
                key={i}
                from={Math.round(SCENE_STARTS_S[i] * TESTIMONIAL_FPS) + TESTIMONIAL_FPS}
                durationInFrames={Math.round(OVERLAY_DURATION_S * TESTIMONIAL_FPS)}
                layout="none"
              >
                <AdOverlayText
                  title={overlay.title}
                  position="bottom"
                />
              </Sequence>
            ))}
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        {/* Crossfade into CTA */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* CTA: Burning guitar background */}
        <TransitionSeries.Sequence durationInFrames={CTA_DURATION}>
          <AdCTAScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
