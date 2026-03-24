import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Video } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AdOverlayText } from "./scenes/AdOverlayText";
import { AdCTAScene } from "./scenes/AdCTAScene";

export const AD_FPS = 30;
export const AD_WIDTH = 1080;
export const AD_HEIGHT = 1920;

// The pre-rendered video is 38s with crossfades already baked in
const VIDEO_DURATION_S = 38;
const VIDEO_DURATION_FRAMES = VIDEO_DURATION_S * AD_FPS; // 1140 frames
const CTA_DURATION = 8 * AD_FPS; // 240 frames
const XFADE = 15; // crossfade into CTA

// Total composition duration
export const AD_DURATION_IN_FRAMES =
  VIDEO_DURATION_FRAMES + CTA_DURATION - XFADE;

// Scene timestamps in seconds (each ~7.5s with 0.5s crossfade overlap)
const SCENE_STARTS_S = [0, 7.5, 15, 22.5, 30];
const OVERLAY_DURATION_S = 6; // show text for 6s per scene

// Overlay text per scene
const OVERLAYS = [
  {
    title: "Learning a new song alone?",
    subtitle: "It doesn't have to be that way",
  },
  {
    title: "One tap. Vocals join you.",
    subtitle: "Sing along with the real track",
  },
  {
    title: "Add the drums. Feel the rhythm.",
    subtitle: "Build your band, one stem at a time",
  },
  {
    title: "The full band is here.",
    subtitle: "Guitar, drums, vocals — all in your living room",
  },
  {
    title: "Play along like you're on stage.",
    subtitle: "Chords · Tabs · Strumming · Lyrics — all in sync",
  },
];

export const SmartGuitarAd: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <TransitionSeries>
        {/* Main video with overlay annotations */}
        <TransitionSeries.Sequence durationInFrames={VIDEO_DURATION_FRAMES}>
          <AbsoluteFill>
            {/* Single pre-rendered video with all scenes */}
            <Video
              src={staticFile("final-output-web.mp4")}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
              volume={(f) => {
                const fadeStart = VIDEO_DURATION_FRAMES - 2 * AD_FPS; // fade out last 2 seconds
                if (f < fadeStart) return 1;
                return Math.max(0, 1 - (f - fadeStart) / (2 * AD_FPS));
              }}
            />

            {/* Text overlays timed to each scene */}
            {OVERLAYS.map((overlay, i) => (
              <Sequence
                key={i}
                from={Math.round(SCENE_STARTS_S[i] * AD_FPS) + AD_FPS}
                durationInFrames={Math.round(OVERLAY_DURATION_S * AD_FPS)}
                layout="none"
              >
                <AdOverlayText
                  title={overlay.title}
                  subtitle={overlay.subtitle}
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
