import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bell,
  Blocks,
  Bug,
  Check,
  CheckCheck,
  CircleCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  Clock,
  Database,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  HardDrive,
  Info,
  Pause,
  RotateCcw,
  TriangleAlert,
  GripVertical,
  LayoutGrid,
  ListPlus,
  Minus,
  MoreVertical,
  Pencil,
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
// Filled by default (the conventional read/da-capo triangle); pass `filled={false}` where a solid
// glyph reads as a blob among outlines (the select-mode pill bar).
export const PlayIcon = ({ color, size = 16, filled = true }: IconProps) => (
  <Play color={color} size={size} fill={filled ? color : 'none'} />
);
export const PlusIcon = ({ color, size = 16 }: IconProps) => <Plus color={color} size={size} />;
export const MinusIcon = ({ color, size = 16 }: IconProps) => <Minus color={color} size={size} />;
export const StarIcon = ({ color, size = 16, filled }: IconProps) => (
  <Star color={color} size={size} fill={filled ? color : 'none'} />
);
export const CheckIcon = ({ color, size = 16 }: IconProps) => <Check color={color} size={size} />;
/** A double check — "everything up to here", as distinct from `CheckIcon`'s single item. */
export const CheckAllIcon = ({ color, size = 16 }: IconProps) => <CheckCheck color={color} size={size} />;
export const ListPlusIcon = ({ color, size = 16 }: IconProps) => <ListPlus color={color} size={size} />;
// Vertical 3-dot "more actions" trigger — the web series-card context-menu affordance.
export const MoreVerticalIcon = ({ color, size = 16 }: IconProps) => <MoreVertical color={color} size={size} />;
export const ChevronDownIcon = ({ color, size = 16 }: IconProps) => <ChevronDown color={color} size={size} />;
export const ChevronRightIcon = ({ color, size = 16 }: IconProps) => <ChevronRight color={color} size={size} />;
export const ChevronUpIcon = ({ color, size = 16 }: IconProps) => <ChevronUp color={color} size={size} />;
export const ArrowUpIcon = ({ color, size = 16 }: IconProps) => <ArrowUp color={color} size={size} />;
export const ArrowDownIcon = ({ color, size = 16 }: IconProps) => <ArrowDown color={color} size={size} />;
// Sort affordance — the Library top bar's sort menu trigger.
export const SortIcon = ({ color, size = 16 }: IconProps) => <ArrowUpDown color={color} size={size} />;
export const GripIcon = ({ color, size = 16 }: IconProps) => <GripVertical color={color} size={size} />;
// Settings section glyphs — General/Bridges/Trackers/Registries/Developer.
export const GeneralSettingsIcon = ({ color, size = 16 }: IconProps) => <SlidersHorizontal color={color} size={size} />;
export const NotificationsIcon = ({ color, size = 16 }: IconProps) => <Bell color={color} size={size} />;
export const BridgesIcon = ({ color, size = 16 }: IconProps) => <Blocks color={color} size={size} />;
export const TrackersIcon = ({ color, size = 16 }: IconProps) => <Compass color={color} size={size} />;
export const RegistriesIcon = ({ color, size = 16 }: IconProps) => <Database color={color} size={size} />;
export const DeveloperIcon = ({ color, size = 16 }: IconProps) => <Terminal color={color} size={size} />;
export const DiagnosticsIcon = ({ color, size = 16 }: IconProps) => <Bug color={color} size={size} />;
// About — the build/version readout at the foot of Settings.
export const AboutIcon = ({ color, size = 16 }: IconProps) => <Info color={color} size={size} />;
// Custom pages — the settings entry for composing your own Comical pages.
export const CustomPagesIcon = ({ color, size = 16 }: IconProps) => <LayoutGrid color={color} size={size} />;
export const DownloadsIcon = ({ color, size = 16 }: IconProps) => <Download color={color} size={size} />;
export const StorageIcon = ({ color, size = 16 }: IconProps) => <HardDrive color={color} size={size} />;
export const DownloadingIcon = ({ color, size = 16 }: IconProps) => <Download color={color} size={size} />;
// Outline (not filled): filled bars read as a solid blob at small sizes.
export const PauseIcon = ({ color, size = 16 }: IconProps) => <Pause color={color} size={size} />;
export const QueuedIcon = ({ color, size = 16 }: IconProps) => <Clock color={color} size={size} />;
export const FailedIcon = ({ color, size = 16 }: IconProps) => <TriangleAlert color={color} size={size} />;
// Fully-downloaded (complete) marker — a bare check for a chapter/series kept offline (the circled
// variant read too close to the multi-select circles beside it).
export const DownloadedIcon = ({ color, size = 16 }: IconProps) => <Check color={color} size={size} />;
export const RetryIcon = ({ color, size = 16 }: IconProps) => <RotateCcw color={color} size={size} />;
// Rename affordance (custom page editor's top bar).
export const PencilIcon = ({ color, size = 16 }: IconProps) => <Pencil color={color} size={size} />;
// Reveal / hide a masked secret field (settings text row).
export const EyeIcon = ({ color, size = 16 }: IconProps) => <Eye color={color} size={size} />;
export const EyeOffIcon = ({ color, size = 16 }: IconProps) => <EyeOff color={color} size={size} />;
// Destructive action — the swipe-to-delete pane and its web hover affordance (see settings/swipeable-row).
export const TrashIcon = ({ color, size = 16 }: IconProps) => <Trash2 color={color} size={size} />;
// Multi-select mode toggle (the per-series download screen's top-bar button) — a circled check.
export const SelectModeIcon = ({ color, size = 16 }: IconProps) => <CircleCheck color={color} size={size} />;
// The selection-staging menu trigger (a bare three-dot ellipsis) — opens Select all / Select unread.
export const SelectOptionsIcon = ({ color, size = 16 }: IconProps) => <Ellipsis color={color} size={size} />;
