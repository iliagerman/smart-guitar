import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { spring } from "remotion";

type ScreenshotShowcaseProps = {
  src: string;
  label?: string;
};

export const ScreenshotShowcase: React.FC<ScreenshotShowcaseProps> = ({
  src,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120 },
  });

  // 3D pop-out: starts scaled down, rotated, and pushed back
  const scale = interpolate(entrance, [0, 1], [0.7, 1]);
  const rotateX = interpolate(entrance, [0, 1], [18, 2]);
  const rotateY = interpolate(entrance, [0, 1], [-8, 0]);
  const translateZ = interpolate(entrance, [0, 1], [-200, 0]);
  const translateY = interpolate(entrance, [0, 1], [80, 0]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  // Subtle floating hover after entrance
  const float = interpolate(
    frame % (fps * 3),
    [0, fps * 1.5, fps * 3],
    [0, -6, 0],
    { extrapolateRight: "clamp" }
  );

  // Shadow gets stronger as it pops out
  const shadowSpread = interpolate(entrance, [0, 1], [5, 30]);
  const shadowBlur = interpolate(entrance, [0, 1], [10, 80]);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        perspective: 1200,
      }}
    >
      {/* Blurred backdrop */}
      <AbsoluteFill
        style={{
          filter: "blur(40px)",
          opacity: 0.3,
          overflow: "hidden",
        }}
      >
        <Img
          src={staticFile(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* Dark overlay on backdrop */}
      <AbsoluteFill
        style={{
          backgroundColor: "rgba(10, 10, 10, 0.7)",
        }}
      />

      {/* 3D screenshot */}
      <div
        style={{
          opacity,
          transform: `
            perspective(1200px)
            translateY(${translateY + float}px)
            translateZ(${translateZ}px)
            rotateX(${rotateX}deg)
            rotateY(${rotateY}deg)
            scale(${scale})
          `,
          transformStyle: "preserve-3d",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        <div
          style={{
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: `
              0 ${shadowSpread}px ${shadowBlur}px rgba(245, 158, 11, 0.15),
              0 ${shadowSpread / 2}px ${shadowBlur / 2}px rgba(0, 0, 0, 0.5),
              0 0 ${shadowSpread}px rgba(245, 158, 11, 0.08)
            `,
            border: "1px solid rgba(245, 158, 11, 0.25)",
          }}
        >
          <Img
            src={staticFile(src)}
            style={{
              maxWidth: 1500,
              maxHeight: 850,
              objectFit: "contain",
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
