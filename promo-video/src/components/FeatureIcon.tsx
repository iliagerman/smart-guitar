import { theme } from "../theme";

type FeatureIconProps = {
  type: "stems" | "chords" | "lyrics" | "tabs";
  size?: number;
};

const StemsIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Audio waveform split into separate stems */}
    <rect x="6" y="28" width="6" height="8" rx="2" fill={color} opacity={0.6} />
    <rect x="15" y="20" width="6" height="24" rx="2" fill={color} opacity={0.7} />
    <rect x="24" y="12" width="6" height="40" rx="2" fill={color} />
    <rect x="33" y="18" width="6" height="28" rx="2" fill={color} opacity={0.8} />
    <rect x="42" y="24" width="6" height="16" rx="2" fill={color} opacity={0.65} />
    <rect x="51" y="14" width="6" height="36" rx="2" fill={color} opacity={0.9} />
    {/* Split line */}
    <line x1="32" y1="4" x2="32" y2="60" stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity={0.3} />
  </svg>
);

const ChordsIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Guitar chord diagram */}
    {/* Fret lines */}
    <line x1="14" y1="16" x2="50" y2="16" stroke={color} strokeWidth="2.5" opacity={0.9} />
    <line x1="14" y1="26" x2="50" y2="26" stroke={color} strokeWidth="1.5" opacity={0.5} />
    <line x1="14" y1="36" x2="50" y2="36" stroke={color} strokeWidth="1.5" opacity={0.5} />
    <line x1="14" y1="46" x2="50" y2="46" stroke={color} strokeWidth="1.5" opacity={0.5} />
    <line x1="14" y1="56" x2="50" y2="56" stroke={color} strokeWidth="1.5" opacity={0.5} />
    {/* String lines */}
    <line x1="14" y1="16" x2="14" y2="56" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="21.2" y1="16" x2="21.2" y2="56" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="28.4" y1="16" x2="28.4" y2="56" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="35.6" y1="16" x2="35.6" y2="56" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="42.8" y1="16" x2="42.8" y2="56" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="50" y1="16" x2="50" y2="56" stroke={color} strokeWidth="1.2" opacity={0.4} />
    {/* Finger positions */}
    <circle cx="21.2" cy="21" r="4" fill={color} />
    <circle cx="35.6" cy="31" r="4" fill={color} />
    <circle cx="42.8" cy="31" r="4" fill={color} />
    {/* Open string markers */}
    <circle cx="14" cy="10" r="3" stroke={color} strokeWidth="1.5" fill="none" />
    <circle cx="50" cy="10" r="3" stroke={color} strokeWidth="1.5" fill="none" />
  </svg>
);

const LyricsIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Text lines representing lyrics */}
    <rect x="10" y="14" width="36" height="5" rx="2.5" fill={color} />
    <rect x="10" y="24" width="28" height="5" rx="2.5" fill={color} opacity={0.7} />
    <rect x="10" y="34" width="32" height="5" rx="2.5" fill={color} opacity={0.5} />
    <rect x="10" y="44" width="24" height="5" rx="2.5" fill={color} opacity={0.3} />
    {/* Sync indicator / playhead */}
    <path d="M52 12 L52 52" stroke={color} strokeWidth="2" strokeDasharray="4 2" opacity={0.4} />
    <path d="M48 22 L56 27 L48 32 Z" fill={color} opacity={0.8} />
  </svg>
);

const TabsIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    {/* Tab staff lines (6 strings) */}
    <line x1="8" y1="14" x2="56" y2="14" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="8" y1="22" x2="56" y2="22" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="8" y1="30" x2="56" y2="30" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="8" y1="38" x2="56" y2="38" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="8" y1="46" x2="56" y2="46" stroke={color} strokeWidth="1.2" opacity={0.4} />
    <line x1="8" y1="54" x2="56" y2="54" stroke={color} strokeWidth="1.2" opacity={0.4} />
    {/* Fret numbers on strings */}
    <text x="16" y="17" fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace">3</text>
    <text x="28" y="25" fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace">5</text>
    <text x="16" y="33" fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace">0</text>
    <text x="40" y="41" fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace">7</text>
    <text x="28" y="49" fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace">2</text>
    <text x="40" y="17" fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace">0</text>
    <text x="48" y="33" fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace">5</text>
  </svg>
);

export const FeatureIcon: React.FC<FeatureIconProps> = ({ type, size = 56 }) => {
  const color = theme.colors.primary;

  switch (type) {
    case "stems":
      return <StemsIcon size={size} color={color} />;
    case "chords":
      return <ChordsIcon size={size} color={color} />;
    case "lyrics":
      return <LyricsIcon size={size} color={color} />;
    case "tabs":
      return <TabsIcon size={size} color={color} />;
  }
};
