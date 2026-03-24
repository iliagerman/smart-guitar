import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { Audio } from "@remotion/media";
import { spring } from "remotion";
import { TypedText } from "../components/TypedText";
import { theme } from "../theme";

export const CTASceneVertical: React.FC = () => {
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
    [1, 1.04, 1],
    { extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
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
          gap: 40,
          padding: "0 50px",
        }}
      >
        {/* Logo */}
        <div
          style={{
            opacity: interpolate(logoEntrance, [0, 1], [0, 1]),
            transform: `scale(${interpolate(logoEntrance, [0, 1], [0.8, 1])})`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
          <Img
            src={staticFile("logo.png")}
            style={{ width: 100, height: 100 }}
          />
          <span
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 56,
              fontWeight: "bold",
              color: theme.colors.primary,
              letterSpacing: 3,
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
          fontSize={44}
          charsPerSecond={18}
          fontWeight={600}
          playSfx
          maxWidth={900}
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
              borderRadius: 50,
              padding: "24px 60px",
              boxShadow: "0 8px 40px rgba(245, 158, 11, 0.3)",
            }}
          >
            <span
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 34,
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
