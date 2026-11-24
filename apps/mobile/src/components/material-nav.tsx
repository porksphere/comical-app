import type { ReactNode } from 'react';

export type MaterialNavTab = {
  name: string;
  label: string;
  /** The tab's screen does not scale back under a series page (lib/series-backdrop). */
  noRecede?: boolean;
};

export type MaterialNavProps = {
  tabs: readonly MaterialNavTab[];
  /** The rail down the side, in place of the bar along the bottom. */
  rail?: boolean;
  /** Before the tab is switched to, or pressed again while it is the one showing. */
  onPress: (name: string, focused: boolean) => void;
};

/** Whether the tabs' navigation is Material's (material-nav.android): its bar, and its rail where
 *  the window is wide enough for one but not for the labelled sidebar. */
export const MATERIAL_NAV: boolean = false;

/** The height of Material's navigation bar and the width of its rail, in dp. */
export const MATERIAL_BAR_HEIGHT: number = 0;
export const MATERIAL_RAIL_WIDTH: number = 0;

export const MaterialNav: (props: MaterialNavProps) => ReactNode = () => null;
