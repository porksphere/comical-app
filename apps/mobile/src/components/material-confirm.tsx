import type { ReactNode } from 'react';

import type { ConfirmRequest } from '@/components/confirm-popup';

/** Android's confirmation (material-confirm.android); `ConfirmPopupHost` draws its own everywhere
 *  else. */
export const MaterialConfirm: (props: { req: ConfirmRequest }) => ReactNode = () => null;
