import { AlertTriangle, Settings } from 'lucide-react';

import type { IconProps } from './ui-icons';

// Web reader icons (lucide, per AGENTS.md). Keep exports in sync with the
// native `.tsx` sibling.

export const SettingsIcon = ({ color, size = 16 }: IconProps) => <Settings color={color} size={size} />;
export const WarnIcon = ({ color, size = 16 }: IconProps) => <AlertTriangle color={color} size={size} />;
