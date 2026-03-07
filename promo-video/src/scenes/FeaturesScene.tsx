import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Sequence } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { ArtworkScene } from "../components/ArtworkScene";
import { FeatureCard } from "../components/FeatureCard";
import { FeatureIcon } from "../components/FeatureIcon";
import { TypedText } from "../components/TypedText";
import { theme } from "../theme";

const features = [
  {
    iconType: "stems" as const,
    title: "Stem Separation",
    description: "Isolate vocals, guitar, bass, drums & piano from any song",
  },
  {
    iconType: "chords" as const,
    title: "Chord Detection",
    description: "AI extracts chords with timestamps synced to playback",
  },
  {
    iconType: "lyrics" as const,
    title: "Lyrics Sync",
    description: "Word-level timed lyrics scroll as the song plays",
  },
  {
    iconType: "tabs" as const,
    title: "Guitar Tabs",
    description: "Auto-generated tabs from the isolated guitar track",
  },
];

export const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ArtworkScene src="artwork/ai_guitar.png" darken={0.7} />

      {/* Voiceover */}
      <Sequence from={Math.round(fps * 0.3)} layout="none">
        <Audio src={staticFile("voiceover/features.mp3")} volume={0.9} />
      </Sequence>

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 100,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <TypedText
          text="Powered by AI"
          startFrame={5}
          fontSize={56}
          charsPerSecond={16}
          playSfx
        />
      </div>

      {/* Feature cards */}
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
          gap: 30,
          padding: "0 60px",
        }}
      >
        {features.map((feature, i) => (
          <FeatureCard
            key={i}
            icon={<FeatureIcon type={feature.iconType} size={56} />}
            title={feature.title}
            description={feature.description}
            delay={Math.round(fps * 0.5 + i * fps * 0.3)}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
