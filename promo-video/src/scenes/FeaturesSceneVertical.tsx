import { AbsoluteFill, useCurrentFrame, useVideoConfig, Sequence } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { ArtworkScene } from "../components/ArtworkScene";
import { FeatureCard } from "../components/FeatureCard";
import { FeatureIcon } from "../components/FeatureIcon";
import { TypedText } from "../components/TypedText";

const features = [
  {
    iconType: "stems" as const,
    title: "Stem Separation",
    description: "Isolate vocals, guitar, bass, drums & piano",
  },
  {
    iconType: "chords" as const,
    title: "Chord Detection",
    description: "AI extracts chords synced to playback",
  },
  {
    iconType: "lyrics" as const,
    title: "Lyrics Sync",
    description: "Word-level timed lyrics as the song plays",
  },
  {
    iconType: "tabs" as const,
    title: "Guitar Tabs",
    description: "Auto-generated tabs from guitar track",
  },
];

export const FeaturesSceneVertical: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ArtworkScene src="artwork/ai_guitar.png" darken={0.75} />

      <Sequence from={Math.round(fps * 0.3)} layout="none">
        <Audio src={staticFile("voiceover/features.mp3")} volume={0.9} />
      </Sequence>

      {/* Title */}
      <div
        style={{
          position: "absolute",
          top: 160,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <TypedText
          text="Powered by AI"
          startFrame={5}
          fontSize={48}
          charsPerSecond={16}
          playSfx
        />
      </div>

      {/* 2x2 grid of feature cards */}
      <div
        style={{
          position: "absolute",
          top: 340,
          left: 40,
          right: 40,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          justifyItems: "center",
        }}
      >
        {features.map((feature, i) => (
          <FeatureCard
            key={i}
            icon={<FeatureIcon type={feature.iconType} size={44} />}
            title={feature.title}
            description={feature.description}
            delay={Math.round(fps * 0.5 + i * fps * 0.3)}
            cardWidth={460}
            cardPadding="28px 20px"
            iconContainerSize={64}
            titleFontSize={24}
            descFontSize={16}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
