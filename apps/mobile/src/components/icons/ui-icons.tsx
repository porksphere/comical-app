import { ChevronDown, Play, Plus, Search, Star, X } from 'lucide-react-native';

export type IconProps = { color: string; size?: number };

export const SearchIcon = ({ color, size = 16 }: IconProps) => <Search color={color} size={size} />;
export const ClearIcon = ({ color, size = 16 }: IconProps) => <X color={color} size={size} />;
export const PlayIcon = ({ color, size = 16 }: IconProps) => <Play color={color} size={size} fill={color} />;
export const PlusIcon = ({ color, size = 16 }: IconProps) => <Plus color={color} size={size} />;
export const StarIcon = ({ color, size = 16 }: IconProps) => <Star color={color} size={size} />;
export const ChevronDownIcon = ({ color, size = 16 }: IconProps) => <ChevronDown color={color} size={size} />;
