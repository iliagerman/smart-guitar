import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { spring } from "remotion";

type ArtworkSceneProps = {
  src: string;
  overlay?: React.ReactNode;
  darken?: number;
};

export const ArtworkScene: React.FC<ArtworkSceneProps> = ({
  src,
  overlay,
  darken = 0.4,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = interpolate(frame, [0, fps * 6], [1.05, 1.0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
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
      <AbsoluteFill
        style={{
          background: `linear-gradient(
            to bottom,
            rgba(0,0,0,${darken * 0.5}) 0%,
            rgba(0,0,0,${darken}) 40%,
            rgba(0,0,0,${darken * 1.2}) 100%
          )`,
        }}
      />
      {overlay && (
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {overlay}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
