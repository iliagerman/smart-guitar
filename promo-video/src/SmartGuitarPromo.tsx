import { AbsoluteFill } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont } from "@remotion/google-fonts/Inter";

import { Background } from "./components/Background";
import { SplashScene } from "./scenes/SplashScene";
import { IntroScene } from "./scenes/IntroScene";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { SearchScene } from "./scenes/SearchScene";
import { SongScene } from "./scenes/SongScene";
import { PlayAlongScene } from "./scenes/PlayAlongScene";
import { LibraryScene } from "./scenes/LibraryScene";
import { CTAScene } from "./scenes/CTAScene";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin"],
});

export const FPS = 30;
const XFADE = 10; // frames

// Scene durations in frames — matched to voiceover lengths + buffer
const SPLASH_FRAMES = FPS * 3;
const INTRO_FRAMES = FPS * 5;
const FEATURES_FRAMES = FPS * 9;
const SEARCH_FRAMES = FPS * 3;
const SONG_FRAMES = FPS * 6;
const PLAY_ALONG_FRAMES = FPS * 10;
const LIBRARY_FRAMES = FPS * 4;
const CTA_FRAMES = FPS * 6;

export const PROMO_DURATION_IN_FRAMES =
  SPLASH_FRAMES +
  INTRO_FRAMES +
  FEATURES_FRAMES +
  SEARCH_FRAMES +
  SONG_FRAMES +
  PLAY_ALONG_FRAMES +
  LIBRARY_FRAMES +
  CTA_FRAMES -
  7 * XFADE; // 7 transitions

export const SmartGuitarPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ fontFamily }}>
      {/* Global background */}
      <Background />

      {/* Background music - lower volume, loops entire video */}
      <Audio src={staticFile("sfx/bgm.mp3")} volume={0.12} loop />

      {/* Scene transitions */}
      <TransitionSeries>
        {/* Scene 1: Splash - flaming guitar + Smart Guitar branding */}
        <TransitionSeries.Sequence durationInFrames={SPLASH_FRAMES}>
          <SplashScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Scene 2: Intro - AI artwork + typed hook */}
        <TransitionSeries.Sequence durationInFrames={INTRO_FRAMES}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Scene 3: Features overview - 4 cards */}
        <TransitionSeries.Sequence durationInFrames={FEATURES_FRAMES}>
          <FeaturesScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Scene 4: Search screenshot */}
        <TransitionSeries.Sequence durationInFrames={SEARCH_FRAMES}>
          <SearchScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Scene 5: Song view screenshot */}
        <TransitionSeries.Sequence durationInFrames={SONG_FRAMES}>
          <SongScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-left" })}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Scene 6: Play along - artwork + mobile screenshot */}
        <TransitionSeries.Sequence durationInFrames={PLAY_ALONG_FRAMES}>
          <PlayAlongScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Scene 7: Library screenshot */}
        <TransitionSeries.Sequence durationInFrames={LIBRARY_FRAMES}>
          <LibraryScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Scene 8: CTA */}
        <TransitionSeries.Sequence durationInFrames={CTA_FRAMES}>
          <CTAScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
