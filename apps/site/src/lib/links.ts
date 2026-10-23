// Every outbound link in one place, so the landing page, the install docs and the README can't
// disagree about where a binary lives.
const REPO = 'https://github.com/porksphere/comical-app';
const RELEASES = `${REPO}/releases`;
const DL = `${RELEASES}/download`;

export const links = {
  repo: REPO,
  releases: RELEASES,
  core: 'https://github.com/porksphere/comical',
  registryTopic: 'https://github.com/topics/comical-registry',
  sidestore: 'https://sidestore.io',
  altstore: 'https://altstore.io',
  ios: {
    source: `${DL}/ios-release/apps.json`,
    ipa: `${RELEASES}/latest`,
  },
  android: {
    apk: `${DL}/android-release/comical-android.apk`,
  },
  desktop: {
    windows: `${DL}/desktop-release/comical-desktop-setup.exe`,
    appimage: `${DL}/desktop-release/comical-desktop-x86_64.AppImage`,
    deb: `${DL}/desktop-release/comical-desktop-amd64.deb`,
  },
  images: {
    host: 'ghcr.io/porksphere/comical-host',
    web: 'ghcr.io/porksphere/comical-app-web',
  },
} as const;

/** Joins a site-relative path onto Astro's configured base. */
export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
