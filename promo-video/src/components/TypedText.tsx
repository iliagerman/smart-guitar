import { useCurrentFrame, useVideoConfig, Sequence } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { theme } from "../theme";

type TypedTextProps = {
  text: string;
  startFrame?: number;
  charsPerSecond?: number;
  fontSize?: number;
  color?: string;
  showCursor?: boolean;
  fontWeight?: string | number;
  maxWidth?: number;
  textAlign?: "left" | "center" | "right";
  playSfx?: boolean;
};

export const TypedText: React.FC<TypedTextProps> = ({
  text,
  startFrame = 0,
  charsPerSecond = 18,
  fontSize = 64,
  color = theme.colors.text,
  showCursor = true,
  fontWeight = "bold",
  maxWidth = 1400,
  textAlign = "center",
  playSfx = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const localFrame = frame - startFrame;
  if (localFrame < 0) return null;

  const budget = Math.floor((localFrame / fps) * charsPerSecond);
  const visibleText = text.slice(0, Math.min(budget, text.length));
  const isComplete = budget >= text.length;

  const cursorOpacity =
    isComplete && showCursor
      ? Math.round(((frame % fps) / fps) * 2) % 2 === 0
        ? 1
        : 0
      : 1;

  // Generate per-letter keystroke audio only when playSfx is true
  const keystrokes: React.ReactNode[] = [];
  if (playSfx) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === " " || text[i] === "\n") continue;
      const appearLocal = Math.ceil(((i + 1) * fps) / charsPerSecond);
      const appearFrame = startFrame + appearLocal;
      keystrokes.push(
        <Sequence key={i} from={appearFrame} durationInFrames={2} layout="none">
          <Audio src={staticFile("sfx/keystroke.mp3")} volume={0.08} />
        </Sequence>
      );
    }
  }

  // Split text by newlines and render as separate lines
  const lines = visibleText.split("\n");

  return (
    <>
      {keystrokes}
      <div
        style={{
          fontFamily: theme.fonts.heading,
          fontSize,
          fontWeight,
          color,
          maxWidth,
          lineHeight: 1.3,
          textAlign,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {lines.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
        {showCursor && !isComplete && (
          <span
            style={{
              opacity: cursorOpacity,
              color: theme.colors.primary,
              fontWeight: 300,
              display: "inline",
            }}
          >
            |
          </span>
        )}
      </div>
    </>
  );
};
