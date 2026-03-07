import { AbsoluteFill, Sequence } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile, useVideoConfig } from "remotion";
import { ScreenshotShowcase } from "../components/ScreenshotShowcase";
import { TypedText } from "../components/TypedText";
import { theme } from "../theme";

export const SearchScene: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ScreenshotShowcase src="screenshots/desktop_search.png" />

      {/* Whoosh */}
      <Sequence from={0} durationInFrames={fps} layout="none">
        <Audio src={staticFile("sfx/whoosh.mp3")} volume={0.3} />
      </Sequence>

      {/* Voiceover */}
      <Sequence from={Math.round(fps * 0.3)} layout="none">
        <Audio src={staticFile("voiceover/search.mp3")} volume={0.9} />
      </Sequence>

      {/* Bottom caption */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <TypedText
          text="Search for any song"
          startFrame={Math.round(fps * 0.3)}
          fontSize={42}
          charsPerSecond={20}
          color={theme.colors.primary}
          showCursor={false}
          playSfx
        />
      </div>
    </AbsoluteFill>
  );
};
