import { AlertTriangle, Bookmark, MoveLeft, MoveRight, MoveVertical, Settings, SkipBack, SkipForward } from 'lucide-react-native';

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
// The reader chrome's save-this-page toggle. Solid when the page is in a collection, outline when
// not — the same `filled` convention StarIcon uses. A BOOKMARK, not a heart or a star, because the
// action is "file this into a collection", not "like it": the two neighbouring glyphs already mean
// other things (the star is the BRIDGE's per-series favorite), and a bookmark is the same shape
// Google Maps uses for save-to-a-list.
export const BookmarkIcon = ({ color, size = 16, filled }: IconProps) => (
  <Bookmark color={color} size={size} fill={filled ? color : 'none'} />
);
