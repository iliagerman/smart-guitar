import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { Audio } from "@remotion/media";
import { spring } from "remotion";
import { TypedText } from "../components/TypedText";
import { theme } from "../theme";

export const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoEntrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: 5,
  });

  const buttonEntrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 2.5),
  });

  const buttonTranslateY = interpolate(buttonEntrance, [0, 1], [30, 0]);
  const buttonOpacity = interpolate(buttonEntrance, [0, 1], [0, 1]);

  const pulse = interpolate(
    frame % (fps * 2),
    [0, fps, fps * 2],
    [1, 1.03, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
      }}
    >
      {/* Voiceover */}
      <Sequence from={Math.round(fps * 0.5)} layout="none">
        <Audio src={staticFile("voiceover/cta.mp3")} volume={0.9} />
      </Sequence>

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 50,
        }}
      >
        {/* Logo */}
        <div
          style={{
            opacity: interpolate(logoEntrance, [0, 1], [0, 1]),
            transform: `scale(${interpolate(logoEntrance, [0, 1], [0.8, 1])})`,
            display: "flex",
            alignItems: "center",
            gap: 30,
          }}
        >
          <Img
            src={staticFile("logo.png")}
            style={{ width: 120, height: 120 }}
          />
          <span
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 72,
              fontWeight: "bold",
              color: theme.colors.primary,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Smart Guitar
          </span>
        </div>

        {/* Typed tagline */}
        <TypedText
          text="Your AI-powered guitar teacher"
          startFrame={Math.round(fps * 0.5)}
          fontSize={60}
          charsPerSecond={18}
          fontWeight={600}
          playSfx
        />

        {/* CTA Button */}
        <div
          style={{
            opacity: buttonOpacity,
            transform: `translateY(${buttonTranslateY}px) scale(${pulse})`,
          }}
        >
          <div
            style={{
              background: `linear-gradient(135deg, ${theme.colors.gradientStart}, ${theme.colors.gradientEnd})`,
              borderRadius: 60,
              padding: "28px 80px",
              boxShadow: "0 8px 40px rgba(245, 158, 11, 0.3)",
            }}
          >
            <span
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 42,
                fontWeight: "bold",
                color: "#fff",
                letterSpacing: 1,
              }}
            >
              Try it free at smart-guitar.com
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
