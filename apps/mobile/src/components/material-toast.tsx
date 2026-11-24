import type { ReactNode } from 'react';

import type { ToastRequest } from '@/components/toast';

/** Android's toast (material-toast.android); `ToastHost` draws its own everywhere else. */
export const MaterialToast: (props: { req: ToastRequest }) => ReactNode = () => null;
