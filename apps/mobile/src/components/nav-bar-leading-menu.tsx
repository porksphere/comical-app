import { Stack } from 'expo-router';
import { PixelRatio, StyleSheet, type ImageURISource, type NativeSyntheticEvent } from 'react-native';

import type { SystemSymbol } from '@/lib/initial-symbol';
import { NavBarLeading, type NavBarLeadingSection } from '../../modules/nav-bar-leading';

export type LeadingMenuRow = {
  id: string;
  title: string;
  /** A `file://` picture, already the size and shape of a row's; it wins over `symbol`. */
  image?: string | undefined;
  symbol?: SystemSymbol | undefined;
  on?: boolean | undefined;
  onPress: () => void;
};

export type LeadingMenuSection = { title: string; rows: LeadingMenuRow[] };

/** A tab's menu button: `image` is its `file://` picture, drawn as it is; `symbol` stands in
 *  without one. */
export type LeadingMenuProps = {
  image?: string | undefined;
  symbol: SystemSymbol;
  label: string;
  sections: LeadingMenuSection[];
};

/**
 * A tab's ONE menu button in the iOS bar, at the trailing edge beside the search, and its flat
 * menu of inline sections: Browse's bridges and pages, Library's collections and kinds. Two
 * parts, since a screen's trailing items all go in ONE `Stack.Toolbar`: expo-router keeps each
 * toolbar's items as one option, and the last toolbar rendered replaces the others' outright.
 * `navBarLeadingMenuItem` is the item for that toolbar, a direct child, as the toolbar reads the
 * element tree and sees nothing through a component; `NavBarLeadingMenu` is the view beside it.
 *
 * react-native-screens replaces every bar item, unanimated, whenever the header config changes at
 * all, so a menu kept in the config, whose pick changes the button's picture and the rows'
 * checks, popped the whole bar on every pick. So the config holds a placeholder that never
 * changes, and `NavBarLeading` (the local `nav-bar-leading` module, a zero-size view in the page
 * where it can reach the screen) sets the live picture, label and menu on that item in place.
 * Without the module the menu lives in the config, as it did.
 */
export function navBarLeadingMenuItem({ image, symbol, label, sections }: LeadingMenuProps) {
  if (NavBarLeading) {
    return <Stack.Toolbar.Menu icon="circle" accessibilityLabel={PLACEHOLDER_LABEL} />;
  }
  return (
    <Stack.Toolbar.Menu
      icon={image ? fileIcon(image) : symbol}
      iconRenderingMode={image ? 'original' : 'template'}
      accessibilityLabel={label}>
      {sections.map((section) => (
        <Stack.Toolbar.Menu key={section.title} inline title={section.title}>
          {section.rows.map((row) => (
            <Stack.Toolbar.MenuAction
              key={row.id}
              isOn={row.on ?? false}
              {...(row.image ? { icon: fileIcon(row.image), iconRenderingMode: 'original' as const } : {})}
              {...(!row.image && row.symbol ? { icon: row.symbol } : {})}
              onPress={row.onPress}>
              {row.title}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      ))}
    </Stack.Toolbar.Menu>
  );
}

/** The module's view for the item `navBarLeadingMenuItem` put in the toolbar; nothing without
 *  the module, where the item holds the menu itself. */
export function NavBarLeadingMenu({ image, symbol, label, sections }: LeadingMenuProps) {
  if (!NavBarLeading) return null;
  const native: NavBarLeadingSection[] = sections.map((section, i) => ({
    title: section.title,
    rows: section.rows.map((row) => ({
      // The section's index keeps ids from two sections apart: a bridge and a page may share one.
      id: `${i}:${row.id}`,
      title: row.title,
      on: row.on ?? false,
      ...(row.image ? { image: row.image } : {}),
      ...(row.symbol ? { symbol: row.symbol } : {}),
    })),
  }));
  const onSelect = (event: NativeSyntheticEvent<{ id: string }>) => {
    const { id } = event.nativeEvent;
    const cut = id.indexOf(':');
    sections[Number(id.slice(0, cut))]?.rows.find((row) => row.id === id.slice(cut + 1))?.onPress();
  };
  return (
    <NavBarLeading
      placeholder={PLACEHOLDER_LABEL}
      {...(image ? { image } : {})}
      symbol={symbol}
      label={label}
      sections={native}
      onSelect={onSelect}
      style={styles.pin}
      pointerEvents="none"
    />
  );
}

// What the module finds its item by among the trailing ones, until it has claimed it; the sort
// menu and the search sit there too.
const PLACEHOLDER_LABEL = 'Menu';

/** A thumb file as a bar image at the screen's scale, so the bitmap rendered for its point size
 *  draws at that size. */
function fileIcon(uri: string): ImageURISource {
  return { uri, scale: PixelRatio.get() };
}

const styles = StyleSheet.create({
  pin: { position: 'absolute', width: 0, height: 0 },
});
