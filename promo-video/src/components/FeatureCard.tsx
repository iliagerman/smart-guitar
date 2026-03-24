import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { spring } from "remotion";
import { theme } from "../theme";

type FeatureCardProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay?: number;
  cardWidth?: number;
  cardPadding?: string;
  iconContainerSize?: number;
  titleFontSize?: number;
  descFontSize?: number;
};

export const FeatureCard: React.FC<FeatureCardProps> = ({
  icon,
  title,
  description,
  delay = 0,
  cardWidth = 350,
  cardPadding = "40px 36px",
  iconContainerSize = 80,
  titleFontSize = 28,
  descFontSize = 18,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
  });

  const translateY = interpolate(entrance, [0, 1], [60, 0]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        background: "rgba(26, 26, 26, 0.9)",
        border: "1px solid rgba(245, 158, 11, 0.2)",
        borderRadius: 20,
        padding: cardPadding,
        width: cardWidth,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          width: iconContainerSize,
          height: iconContainerSize,
          borderRadius: iconContainerSize / 2,
          background: "rgba(245, 158, 11, 0.1)",
          border: "1.5px solid rgba(245, 158, 11, 0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 24px rgba(245, 158, 11, 0.12)",
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontFamily: theme.fonts.heading,
          fontSize: titleFontSize,
          fontWeight: "bold",
          color: theme.colors.text,
          textAlign: "center",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: theme.fonts.body,
          fontSize: descFontSize,
          color: theme.colors.textMuted,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        {description}
      </div>
    </div>
  );
};
