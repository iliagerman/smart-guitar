import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio, Video } from "@remotion/media";
import { theme } from "../theme";

export const AdCTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo entrance
  const logoEntrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 0.3),
  });

  // Title entrance
  const titleEntrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 0.8),
  });

  // Free trial text
  const freeEntrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 1.5),
  });

  // CTA button
  const buttonEntrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 2.2),
  });

  // Subtle button pulse
  const pulse = interpolate(
    frame % (fps * 2),
    [0, fps, fps * 2],
    [1, 1.04, 1],
    { extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill>
      {/* Background: burning guitar video */}
      <Video
        src={staticFile("guitar.mp4")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        muted
        loop
      />

      {/* Epic CTA sound effect */}
      <Audio
        src={staticFile("sfx/cta-epic.mp3")}
        volume={(f) =>
          interpolate(f, [0, 15], [0, 0.8], { extrapolateRight: "clamp" })
        }
      />

      {/* Dark overlay for readability */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.8) 50%, rgba(0,0,0,0.9) 100%)",
        }}
      />

      {/* Content */}
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
          padding: "0 60px",
        }}
      >
        {/* Logo */}
        <div
          style={{
            opacity: interpolate(logoEntrance, [0, 1], [0, 1]),
            transform: `scale(${interpolate(logoEntrance, [0, 1], [0.5, 1])})`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
          <Img
            src={staticFile("logo.png")}
            style={{ width: 140, height: 140 }}
          />
          <span
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 64,
              fontWeight: "bold",
              color: theme.colors.primary,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            Smart Guitar
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            opacity: interpolate(titleEntrance, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(titleEntrance, [0, 1], [20, 0])}px)`,
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 38,
              fontWeight: 500,
              color: theme.colors.text,
              textAlign: "center",
              display: "block",
              lineHeight: 1.4,
            }}
          >
            Learn any song.{"\n"}Play like a pro.
          </span>
        </div>

        {/* Free trial badge */}
        <div
          style={{
            opacity: interpolate(freeEntrance, [0, 1], [0, 1]),
            transform: `scale(${interpolate(freeEntrance, [0, 1], [0.8, 1])})`,
            background: "rgba(245, 158, 11, 0.15)",
            border: `2px solid ${theme.colors.primary}`,
            borderRadius: 20,
            padding: "18px 40px",
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 44,
              fontWeight: 700,
              color: theme.colors.primary,
              textAlign: "center",
              display: "block",
            }}
          >
            2 WEEKS FREE
          </span>
        </div>

        {/* CTA Button */}
        <div
          style={{
            opacity: interpolate(buttonEntrance, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(buttonEntrance, [0, 1], [30, 0])}px) scale(${pulse})`,
          }}
        >
          <div
            style={{
              background: `linear-gradient(135deg, ${theme.colors.gradientStart}, ${theme.colors.gradientEnd})`,
              borderRadius: 60,
              padding: "28px 70px",
              boxShadow: "0 8px 40px rgba(245, 158, 11, 0.4)",
            }}
          >
            <span
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 36,
                fontWeight: "bold",
                color: "#fff",
                letterSpacing: 1,
              }}
            >
              Start Free at smart-guitar.com
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
