import { AbsoluteFill, Sequence } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont } from "@remotion/google-fonts/Inter";

import { Background } from "./components/Background";
import { SplashScene } from "./scenes/SplashScene";
import { IntroScene } from "./scenes/IntroScene";
import { FeaturesSceneVertical } from "./scenes/FeaturesSceneVertical";
import { ScreenshotShowcase } from "./components/ScreenshotShowcase";
import { TypedText } from "./components/TypedText";
import { PlayAlongSceneVertical } from "./scenes/PlayAlongSceneVertical";
import { CTASceneVertical } from "./scenes/CTASceneVertical";
import { theme } from "./theme";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin"],
});

export const VERTICAL_FPS = 30;
export const VERTICAL_WIDTH = 1080;
export const VERTICAL_HEIGHT = 1920;

const XFADE = 10;

const SPLASH_FRAMES = VERTICAL_FPS * 3;
const INTRO_FRAMES = VERTICAL_FPS * 5;
const FEATURES_FRAMES = VERTICAL_FPS * 9;
const SEARCH_FRAMES = VERTICAL_FPS * 3;
const SONG_FRAMES = VERTICAL_FPS * 6;
const PLAY_ALONG_FRAMES = VERTICAL_FPS * 10;
const LIBRARY_FRAMES = VERTICAL_FPS * 4;
const CTA_FRAMES = VERTICAL_FPS * 6;

export const VERTICAL_PROMO_DURATION =
  SPLASH_FRAMES +
  INTRO_FRAMES +
  FEATURES_FRAMES +
  SEARCH_FRAMES +
  SONG_FRAMES +
  PLAY_ALONG_FRAMES +
  LIBRARY_FRAMES +
  CTA_FRAMES -
  7 * XFADE;

// Vertical screenshot scene wrapper — uses mobile screenshots with adapted sizing
const VerticalScreenshotScene: React.FC<{
  screenshot: string;
  voiceover: string;
  caption: string;
  captionFontSize?: number;
}> = ({ screenshot, voiceover, caption, captionFontSize = 36 }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ScreenshotShowcase
        src={screenshot}
        imgMaxWidth={700}
        imgMaxHeight={1200}
      />

      <Sequence from={0} durationInFrames={fps} layout="none">
        <Audio src={staticFile("sfx/whoosh.mp3")} volume={0.3} />
      </Sequence>

      <Sequence from={Math.round(fps * 0.3)} layout="none">
        <Audio src={staticFile(voiceover)} volume={0.9} />
      </Sequence>

      <div
        style={{
          position: "absolute",
          bottom: 100,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <TypedText
          text={caption}
          startFrame={Math.round(fps * 0.3)}
          fontSize={captionFontSize}
          charsPerSecond={20}
          color={theme.colors.primary}
          showCursor={false}
          playSfx
          maxWidth={900}
        />
      </div>
    </AbsoluteFill>
  );
};

export const SmartGuitarPromoVertical: React.FC = () => {
  return (
    <AbsoluteFill style={{ fontFamily }}>
      <Background />
      <Audio src={staticFile("sfx/bgm.mp3")} volume={0.12} loop />

      <TransitionSeries>
        {/* Splash */}
        <TransitionSeries.Sequence durationInFrames={SPLASH_FRAMES}>
          <SplashScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Intro */}
        <TransitionSeries.Sequence durationInFrames={INTRO_FRAMES}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Features - 2x2 grid */}
        <TransitionSeries.Sequence durationInFrames={FEATURES_FRAMES}>
          <FeaturesSceneVertical />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Search - mobile screenshot */}
        <TransitionSeries.Sequence durationInFrames={SEARCH_FRAMES}>
          <VerticalScreenshotScene
            screenshot="screenshots/mobile_search.png"
            voiceover="voiceover/search.mp3"
            caption="Search for any song"
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Song view - mobile screenshot */}
        <TransitionSeries.Sequence durationInFrames={SONG_FRAMES}>
          <VerticalScreenshotScene
            screenshot="screenshots/mobile_song.png"
            voiceover="voiceover/song.mp3"
            caption="Chords, lyrics & tabs — all in sync"
            captionFontSize={34}
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Play along - vertical stack */}
        <TransitionSeries.Sequence durationInFrames={PLAY_ALONG_FRAMES}>
          <PlayAlongSceneVertical />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* Library - mobile screenshot */}
        <TransitionSeries.Sequence durationInFrames={LIBRARY_FRAMES}>
          <VerticalScreenshotScene
            screenshot="screenshots/mobile_library.png"
            voiceover="voiceover/library.mp3"
            caption="Your entire library, organized"
          />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: XFADE })}
        />

        {/* CTA */}
        <TransitionSeries.Sequence durationInFrames={CTA_FRAMES}>
          <CTASceneVertical />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
