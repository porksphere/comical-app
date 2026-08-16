import { AlertTriangle, Heart, MoveLeft, MoveRight, MoveVertical, Settings, SkipBack, SkipForward } from 'lucide-react-native';

import type { IconProps } from './ui-icons';

export const SettingsIcon = ({ color, size = 16 }: IconProps) => <Settings color={color} size={size} />;
// The chapter-skip pair flanking the reader's page slider — lucide's equivalents of
// Material's SkipPrevious/SkipNext, which is what Mihon's chapter navigator uses.
export const SkipBackIcon = ({ color, size = 16 }: IconProps) => <SkipBack color={color} size={size} />;
export const SkipForwardIcon = ({ color, size = 16 }: IconProps) => <SkipForward color={color} size={size} />;
export const WarnIcon = ({ color, size = 16 }: IconProps) => <AlertTriangle color={color} size={size} />;
export const MoveRightIcon = ({ color, size = 16 }: IconProps) => <MoveRight color={color} size={size} />;
export const MoveVerticalIcon = ({ color, size = 16 }: IconProps) => <MoveVertical color={color} size={size} />;
export const MoveLeftIcon = ({ color, size = 16 }: IconProps) => <MoveLeft color={color} size={size} />;
// The reader chrome's collect-this-page toggle. Solid when the page is collected, outline when not
// — the same `filled` convention StarIcon uses for the series star it sits beside in the settings
// sheet. A heart rather than a star deliberately: the star already means the BRIDGE's own
// per-series favorite, which is a different thing entirely.
export const HeartIcon = ({ color, size = 16, filled }: IconProps) => (
  <Heart color={color} size={size} fill={filled ? color : 'none'} />
);
