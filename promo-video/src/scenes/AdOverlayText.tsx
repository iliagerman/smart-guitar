import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";

interface AdOverlayTextProps {
  title: string;
  subtitle?: string;
  position?: "top" | "bottom" | "center";
}

export const AdOverlayText: React.FC<AdOverlayTextProps> = ({
  title,
  subtitle,
  position = "bottom",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    delay: Math.round(fps * 0.3),
  });

  const fadeOut = interpolate(
    frame,
    [fps * 6.5, fps * 7.5],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const opacity = Math.min(entrance, fadeOut);
  const translateY = interpolate(entrance, [0, 1], [40, 0]);

  const positionStyle = {
    top: position === "top" ? 80 : position === "center" ? "50%" : undefined,
    bottom: position === "bottom" ? 120 : undefined,
    transform:
      position === "center"
        ? `translateY(calc(-50% + ${translateY}px))`
        : `translateY(${translateY}px)`,
  };

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 40,
          right: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          opacity,
          ...positionStyle,
        }}
      >
        {/* Title */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(12px)",
            borderRadius: 20,
            padding: "28px 48px",
            borderLeft: `6px solid ${theme.colors.primary}`,
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 62,
              fontWeight: 700,
              color: theme.colors.text,
              lineHeight: 1.3,
              textAlign: "center",
              display: "block",
            }}
          >
            {title}
          </span>
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              background: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(8px)",
              borderRadius: 16,
              padding: "16px 32px",
            }}
          >
            <span
              style={{
                fontFamily: theme.fonts.body,
                fontSize: 40,
                fontWeight: 500,
                color: theme.colors.primary,
                textAlign: "center",
                display: "block",
              }}
            >
              {subtitle}
            </span>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
