import { BookCopy, BookOpen, FileImage } from 'lucide-react-native';

import type { IconProps } from './ui-icons';

// The three collection-item types, as tile badges. Every collected card is the same 2:3 tile, so
// the badge icon is what tells a saved SERIES from a saved CHAPTER from a saved PAGE at a glance —
// text labels were tried and read as noise at tile size.
export const SeriesItemIcon = ({ color, size = 16 }: IconProps) => <BookCopy color={color} size={size} />;
export const ChapterItemIcon = ({ color, size = 16 }: IconProps) => <BookOpen color={color} size={size} />;
export const PageItemIcon = ({ color, size = 16 }: IconProps) => <FileImage color={color} size={size} />;
