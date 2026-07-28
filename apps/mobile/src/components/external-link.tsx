import { Href } from 'expo-router';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { type ComponentProps } from 'react';

import { Link } from '@/lib/nav';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & {
  href: Href & string;
  /** Automation selector — required so the link is reachable (see src/lib/test-id.ts). */
  testID: string;
};

export function ExternalLink({ href, testID, ...rest }: Props) {
  return (
    <Link
      testID={testID}
      target="_blank"
      {...rest}
      href={href}
      onPress={async (event) => {
        if (process.env.EXPO_OS !== 'web') {
          // Prevent the default behavior of linking to the default browser on native.
          event.preventDefault();
          // Open the link in an in-app browser.
          await openBrowserAsync(href, {
            presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
          });
        }
      }}
    />
  );
}
