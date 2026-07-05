import {
  Blocks,
  Bug,
  ChevronDown,
  ChevronRight,
  Compass,
  Database,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Terminal,
  X,
} from 'lucide-react-native';

export type IconProps = { color: string; size?: number };

export const SearchIcon = ({ color, size = 16 }: IconProps) => <Search color={color} size={size} />;
export const ClearIcon = ({ color, size = 16 }: IconProps) => <X color={color} size={size} />;
export const PlayIcon = ({ color, size = 16 }: IconProps) => <Play color={color} size={size} fill={color} />;
export const PlusIcon = ({ color, size = 16 }: IconProps) => <Plus color={color} size={size} />;
export const StarIcon = ({ color, size = 16 }: IconProps) => <Star color={color} size={size} />;
export const ChevronDownIcon = ({ color, size = 16 }: IconProps) => <ChevronDown color={color} size={size} />;
export const ChevronRightIcon = ({ color, size = 16 }: IconProps) => <ChevronRight color={color} size={size} />;
// Settings section glyphs — General/Bridges/Trackers/Registries/Developer.
export const GeneralSettingsIcon = ({ color, size = 16 }: IconProps) => <SlidersHorizontal color={color} size={size} />;
export const BridgesIcon = ({ color, size = 16 }: IconProps) => <Blocks color={color} size={size} />;
export const TrackersIcon = ({ color, size = 16 }: IconProps) => <Compass color={color} size={size} />;
export const RegistriesIcon = ({ color, size = 16 }: IconProps) => <Database color={color} size={size} />;
export const DeveloperIcon = ({ color, size = 16 }: IconProps) => <Terminal color={color} size={size} />;
export const DiagnosticsIcon = ({ color, size = 16 }: IconProps) => <Bug color={color} size={size} />;
