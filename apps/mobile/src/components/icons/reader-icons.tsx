import { AlertTriangle, Settings } from 'lucide-react-native';

import type { IconProps } from './ui-icons';

export const SettingsIcon = ({ color, size = 16 }: IconProps) => <Settings color={color} size={size} />;
export const WarnIcon = ({ color, size = 16 }: IconProps) => <AlertTriangle color={color} size={size} />;
