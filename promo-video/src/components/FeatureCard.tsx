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
};

export const FeatureCard: React.FC<FeatureCardProps> = ({
  icon,
  title,
  description,
  delay = 0,
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
        padding: "40px 36px",
        width: 350,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
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
          fontSize: 28,
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
          fontSize: 18,
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
