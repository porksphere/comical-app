/** The tab bar's routes, by tab name. The one place both the bar and whatever asks "is this a
 *  root tab?" read them from. */
export const ROOT_TAB_PATHS = {
  browse: '/',
  library: '/library',
  history: '/history',
  activity: '/activity',
  settings: '/settings',
} as const;

const paths: readonly string[] = Object.values(ROOT_TAB_PATHS);

/** Whether `pathname` is one of the tabs themselves — a root, with nothing of the app's to go back
 *  to, however the browser's history got there. */
export const isRootTabPath = (pathname: string): boolean => paths.includes(pathname);
