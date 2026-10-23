// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// The site is served from the repo's GitHub Pages root, which is a subpath of the user site.
// SITE_URL/SITE_BASE let a custom domain (or a branch preview) point it elsewhere without an edit.
const site = process.env.SITE_URL ?? 'https://porksphere.github.io';
const base = process.env.SITE_BASE ?? '/comical-app';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Comical',
      description: 'A comic reader for iOS, Android, desktop and the web.',
      logo: { src: './src/assets/logo.svg', alt: '' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/theme.css', './src/styles/device.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/porksphere/comical-app' }],
      editLink: { baseUrl: 'https://github.com/porksphere/comical-app/edit/main/apps/site/' },
      sidebar: [
        { label: 'Install', slug: 'install' },
        { label: 'Getting started', slug: 'getting-started' },
        { label: 'How it works', slug: 'concepts' },
        {
          label: 'Guides',
          items: [
            { label: 'Browse and search', slug: 'guides/browse' },
            { label: 'Reader', slug: 'guides/reader' },
            { label: 'Library', slug: 'guides/library' },
            { label: 'Downloads', slug: 'guides/downloads' },
            { label: 'Activity and notifications', slug: 'guides/activity' },
            { label: 'Tracking', slug: 'guides/tracking' },
            { label: 'Sync', slug: 'guides/sync' },
            { label: 'Keyboard shortcuts', slug: 'guides/keyboard-shortcuts' },
          ],
        },
        { label: 'Self-hosting', slug: 'self-hosting' },
        { label: 'Troubleshooting', slug: 'troubleshooting' },
        {
          label: 'For developers',
          items: [
            { label: 'Building from source', slug: 'developers/development' },
            { label: 'Architecture', slug: 'developers/architecture' },
            { label: 'Profiling', slug: 'developers/profiling' },
            { label: 'Writing a bridge', slug: 'developers/bridges' },
            { label: 'Publishing a registry', slug: 'developers/registries' },
          ],
        },
        { label: 'Changelog', slug: 'changelog' },
        { label: 'Privacy', slug: 'privacy' },
      ],
    }),
  ],
});
