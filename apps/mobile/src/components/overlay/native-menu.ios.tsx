import { Button, Host, Menu, RNHostView, Section, Toggle } from '@expo/ui/swift-ui';

import type { NativeMenuProps } from '@/components/overlay/native-menu';
import { useActiveColorScheme } from '@/hooks/use-theme';

// A selection row is a `Toggle`, which is how SwiftUI draws a menu item with a check. The host is
// told the app's scheme rather than inheriting the system's: the in-app appearance setting is not
// pushed down to UIKit, and a light menu over a dark app reads as a glitch.
export function NativeMenu({ sections, testID, children }: NativeMenuProps) {
  const scheme = useActiveColorScheme();
  return (
    <Host matchContents colorScheme={scheme} ignoreSafeArea="all" testID={testID}>
      <Menu label={<RNHostView matchContents>{children}</RNHostView>}>
        {sections.map((section) => (
          <Section key={section.key} title={section.title}>
            {section.items.map((item) =>
              item.checked === undefined ? (
                <Button key={item.key} label={item.label} onPress={item.onSelect} />
              ) : (
                <Toggle key={item.key} label={item.label} isOn={item.checked} onIsOnChange={item.onSelect} />
              ),
            )}
          </Section>
        ))}
      </Menu>
    </Host>
  );
}
