import { ChevronDown, Play, Plus, Search, Star, X } from 'lucide-react';

import type { IconProps } from './ui-icons';

// Web UI icons. Always use lucide on web (see AGENTS.md); the native `.tsx`
// sibling uses system glyphs because lucide-react is web-only. Keep exports in
// sync with the native file.

export const SearchIcon = ({ color, size = 16 }: IconProps) => <Search color={color} size={size} />;
export const ClearIcon = ({ color, size = 16 }: IconProps) => <X color={color} size={size} />;
export const PlayIcon = ({ color, size = 16 }: IconProps) => <Play color={color} size={size} fill={color} />;
export const PlusIcon = ({ color, size = 16 }: IconProps) => <Plus color={color} size={size} />;
export const StarIcon = ({ color, size = 16 }: IconProps) => <Star color={color} size={size} />;
export const ChevronDownIcon = ({ color, size = 16 }: IconProps) => <ChevronDown color={color} size={size} />;
