import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Database,
  MoreVertical,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Terminal,
  Trash2,
  X,
} from 'lucide-react-native';

export type IconProps = {
  color: string;
  size?: number;
  /** Paint the glyph solid rather than as an outline — how a toggled-ON state reads (a filled star),
   *  without spending a colour on it. Ignored by glyphs that have no meaningful fill. */
  filled?: boolean;
};

export const SearchIcon = ({ color, size = 16 }: IconProps) => <Search color={color} size={size} />;
export const ClearIcon = ({ color, size = 16 }: IconProps) => <X color={color} size={size} />;
export const PlayIcon = ({ color, size = 16 }: IconProps) => <Play color={color} size={size} fill={color} />;
export const PlusIcon = ({ color, size = 16 }: IconProps) => <Plus color={color} size={size} />;
export const StarIcon = ({ color, size = 16, filled }: IconProps) => (
  <Star color={color} size={size} fill={filled ? color : 'none'} />
);
export const CheckIcon = ({ color, size = 16 }: IconProps) => <Check color={color} size={size} />;
// Vertical 3-dot "more actions" trigger — the web series-card context-menu affordance.
export const MoreVerticalIcon = ({ color, size = 16 }: IconProps) => <MoreVertical color={color} size={size} />;
export const ChevronDownIcon = ({ color, size = 16 }: IconProps) => <ChevronDown color={color} size={size} />;
export const ChevronRightIcon = ({ color, size = 16 }: IconProps) => <ChevronRight color={color} size={size} />;
export const ArrowUpIcon = ({ color, size = 16 }: IconProps) => <ArrowUp color={color} size={size} />;
export const ArrowDownIcon = ({ color, size = 16 }: IconProps) => <ArrowDown color={color} size={size} />;
// Settings section glyphs — General/Bridges/Trackers/Registries/Developer.
export const GeneralSettingsIcon = ({ color, size = 16 }: IconProps) => <SlidersHorizontal color={color} size={size} />;
export const BridgesIcon = ({ color, size = 16 }: IconProps) => <Blocks color={color} size={size} />;
export const TrackersIcon = ({ color, size = 16 }: IconProps) => <Compass color={color} size={size} />;
export const RegistriesIcon = ({ color, size = 16 }: IconProps) => <Database color={color} size={size} />;
export const DeveloperIcon = ({ color, size = 16 }: IconProps) => <Terminal color={color} size={size} />;
export const DiagnosticsIcon = ({ color, size = 16 }: IconProps) => <Bug color={color} size={size} />;
// Destructive action — the swipe-to-delete pane and its web hover affordance (see settings/swipeable-row).
export const TrashIcon = ({ color, size = 16 }: IconProps) => <Trash2 color={color} size={size} />;
