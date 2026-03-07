import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { spring } from "remotion";
import { theme } from "../theme";

export const SplashScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Image fade in
  const imgOpacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Logo entrance with spring
  const logoSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 0.3),
  });
  const logoScale = interpolate(logoSpring, [0, 1], [0.7, 1]);
  const logoOpacity = interpolate(logoSpring, [0, 1], [0, 1]);

  // Text entrance
  const textSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 0.8),
  });
  const textOpacity = interpolate(textSpring, [0, 1], [0, 1]);
  const textY = interpolate(textSpring, [0, 1], [20, 0]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Flaming guitar background */}
      <AbsoluteFill style={{ opacity: imgOpacity }}>
        <Img
          src={staticFile("artwork/splash.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* Dark gradient overlay for text readability */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.6) 80%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      {/* Logo + brand name at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 120,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 72,
              fontWeight: "bold",
              color: theme.colors.primary,
              letterSpacing: 6,
              textTransform: "uppercase",
            }}
          >
            Smart Guitar
          </span>
        </div>

        <div
          style={{
            opacity: textOpacity,
            transform: `translateY(${textY}px)`,
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.body,
              fontSize: 28,
              color: theme.colors.textMuted,
              letterSpacing: 2,
            }}
          >
            AI-Powered Guitar Learning
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
