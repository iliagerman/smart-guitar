import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { Audio } from "@remotion/media";
import { spring } from "remotion";
import { ArtworkScene } from "../components/ArtworkScene";
import { TypedText } from "../components/TypedText";
import { theme } from "../theme";

export const PlayAlongScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const phoneEntrance = spring({
    frame,
    fps,
    delay: Math.round(fps * 0.3),
    config: { damping: 200 },
  });

  const phoneTranslateY = interpolate(phoneEntrance, [0, 1], [100, 0]);
  const phoneOpacity = interpolate(phoneEntrance, [0, 1], [0, 1]);

  return (
    <AbsoluteFill>
      <ArtworkScene src="artwork/play_along.png" darken={0.6} />

      {/* Voiceover */}
      <Sequence from={Math.round(fps * 0.3)} layout="none">
        <Audio src={staticFile("voiceover/play_along.mp3")} volume={0.9} />
      </Sequence>

      {/* Layout: text left, phone right */}
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
          gap: 120,
          padding: "0 120px",
        }}
      >
        {/* Text side */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 30,
          }}
        >
          <TypedText
            text="Mute the guitar."
            startFrame={Math.round(fps * 0.5)}
            fontSize={58}
            charsPerSecond={16}
            textAlign="left"
            playSfx
          />
          <TypedText
            text="Play along."
            startFrame={Math.round(fps * 1.5)}
            fontSize={58}
            charsPerSecond={16}
            textAlign="left"
            playSfx
          />
          <TypedText
            text="Follow chords in real time."
            startFrame={Math.round(fps * 2.5)}
            fontSize={58}
            charsPerSecond={18}
            textAlign="left"
            playSfx
          />
        </div>

        {/* Phone screenshot */}
        <div
          style={{
            opacity: phoneOpacity,
            transform: `translateY(${phoneTranslateY}px)`,
          }}
        >
          <div
            style={{
              borderRadius: 32,
              overflow: "hidden",
              boxShadow: "0 30px 80px rgba(245, 158, 11, 0.2), 0 8px 32px rgba(0,0,0,0.6)",
              border: "2px solid rgba(245, 158, 11, 0.3)",
            }}
          >
            <Img
              src={staticFile("screenshots/mobile_song.png")}
              style={{
                height: 750,
                objectFit: "contain",
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
