// Copies the repo's own docs into the site as pages, so the contributor docs have one source and
// the site never drifts from it. Runs before every build and dev; the outputs are gitignored.
//
// Each page gets Starlight frontmatter, its first H1 dropped (the title renders it), its links to
// sibling docs rewritten to site routes, and any other relative link pointed at the file on GitHub.
// The changelog additionally loses its CI-facing preamble and links each commit hash.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(fileURLToPath(import.meta.url), '../..');
const repo = resolve(site, '../..');
const out = join(site, 'src/content/docs');
const GITHUB = 'https://github.com/porksphere/comical-app';

type Page = {
  src: string;
  dest: string;
  title: string;
  description: string;
  route: string;
  body?: (md: string) => string;
};

const pages: Page[] = [
  {
    src: 'docs/DEVELOPMENT.md',
    dest: 'developers/development.md',
    route: '/developers/development/',
    title: 'Building from source',
    description: 'Running Comical locally, building each platform, and how releases are cut.',
  },
  {
    src: 'docs/ARCHITECTURE.md',
    dest: 'developers/architecture.md',
    route: '/developers/architecture/',
    title: 'Architecture',
    description: 'Why React Native, how bridges run on-device, and how state is split.',
  },
  {
    src: 'docs/PROFILING.md',
    dest: 'developers/profiling.md',
    route: '/developers/profiling/',
    title: 'Profiling',
    description: 'Finding performance bottlenecks on a device.',
  },
  {
    src: 'CHANGELOG.md',
    dest: 'changelog.md',
    route: '/changelog/',
    title: 'Changelog',
    description: 'Every released version of Comical, newest first.',
    body: (md) => {
      const first = md.indexOf('\n## ');
      const sections = first >= 0 ? md.slice(first + 1) : md;
      return (
        `Binaries for each version are attached to its [GitHub release](${GITHUB}/releases).\n\n` +
        sections.replace(/\(([0-9a-f]{7,10})\)/g, (_, sha) => `([${sha}](${GITHUB}/commit/${sha}))`)
      );
    },
  },
];

// Links between synced docs become site routes; the rest point at the file in the repo.
const routeFor = new Map(pages.map((p) => [p.src, p.route]));

// Site routes are emitted RELATIVE to the page, so they survive whatever `base` the site is built
// under; an absolute `/developers/...` would miss the Pages subpath.
function rewriteLinks(md: string, page: Page): string {
  const srcDir = posix.dirname(page.src);
  return md.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) => {
    if (/^[a-z]+:|^#|^\//i.test(target)) return whole;
    const [path, hash = ''] = target.split('#');
    const repoPath = posix.normalize(posix.join(srcDir, path));
    const route = routeFor.get(repoPath);
    const suffix = hash ? `#${hash}` : '';
    if (route) return `](${posix.relative(page.route, route)}/${suffix})`;
    return `](${GITHUB}/blob/main/${repoPath}${suffix})`;
  });
}

const yaml = (s: string) => JSON.stringify(s);

for (const page of pages) {
  let md = await readFile(join(repo, page.src), 'utf8');
  md = md.replace(/^# .*\n+/, '');
  if (page.body) md = page.body(md);
  md = rewriteLinks(md, page);
  const frontmatter = [
    '---',
    `title: ${yaml(page.title)}`,
    `description: ${yaml(page.description)}`,
    'editUrl: false',
    '---',
    '',
    `:::note`,
    `Generated from [\`${page.src}\`](${GITHUB}/blob/main/${page.src}) in the repository — edit it there.`,
    `:::`,
    '',
  ].join('\n');
  const dest = join(out, page.dest);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, frontmatter + md);
  console.log(`  ${page.src} → ${posix.join('src/content/docs', page.dest)}`);
}
