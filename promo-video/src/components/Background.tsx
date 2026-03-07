import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { interpolate } from "remotion";
import { theme } from "../theme";

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const shimmer = interpolate(
    frame % (fps * 8),
    [0, fps * 4, fps * 8],
    [0, 15, 0],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(245, 158, 11, 0.08) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 50%, rgba(239, 68, 68, 0.06) 0%, transparent 50%),
          radial-gradient(ellipse at 50% ${50 + shimmer}%, rgba(245, 158, 11, 0.04) 0%, transparent 60%),
          ${theme.colors.background}
        `,
      }}
    />
  );
};
