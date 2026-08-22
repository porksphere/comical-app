// Ambient declarations for CSS imports.
//
// Metro/Expo web supports importing CSS: `.module.css` yields a class-name map
// and a plain `.css` import is a side-effect global stylesheet (see
// src/constants/theme.ts → '@/global.css'). No `.module.css` is in the tree
// right now — the declaration stays so adding one needs no type plumbing.
// TypeScript needs these module shapes to typecheck those imports.

declare module '*.module.css' {
  const classes: { readonly [className: string]: string };
  export default classes;
}

declare module '*.css';
