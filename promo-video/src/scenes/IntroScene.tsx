import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { TypedText } from "../components/TypedText";
import { ArtworkScene } from "../components/ArtworkScene";

export const IntroScene: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ArtworkScene src="artwork/hero_band.png" darken={0.55} />

      {/* Voiceover */}
      <Sequence from={Math.round(fps * 0.5)} layout="none">
        <Audio src={staticFile("voiceover/intro.mp3")} volume={0.9} />
      </Sequence>

      {/* Typed text centered */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 120px",
        }}
      >
        <TypedText
          text="What if AI could teach you any song on guitar?"
          startFrame={Math.round(fps * 0.3)}
          fontSize={68}
          charsPerSecond={20}
          fontWeight="bold"
          playSfx
          maxWidth={1500}
        />
      </div>
    </AbsoluteFill>
  );
};
