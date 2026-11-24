import type { ReactNode } from 'react';

import type { ContextMenuRequest } from '@/components/context-menu-host';
import type { MenuRowSpec } from '@/components/context-menu-material';

/** Android's menu for `ContextMenuHost` (material-context-menu.android); the host draws its own
 *  everywhere else. */
export const MaterialContextMenu: (props: { req: ContextMenuRequest; rows: MenuRowSpec[] }) => ReactNode = () => null;
