import { theme } from "../theme";

type GradientTextProps = {
  children: React.ReactNode;
  fontSize?: number;
  fontWeight?: string | number;
};

export const GradientText: React.FC<GradientTextProps> = ({
  children,
  fontSize = 72,
  fontWeight = "bold",
}) => {
  return (
    <span
      style={{
        fontFamily: theme.fonts.heading,
        fontSize,
        fontWeight,
        background: `linear-gradient(135deg, ${theme.colors.gradientStart}, ${theme.colors.gradientEnd})`,
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: 1.2,
      }}
    >
      {children}
    </span>
  );
};
