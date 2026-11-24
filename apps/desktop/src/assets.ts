/**
 * Resolves a file from the app's Vite `public/` folder.
 * Works for both the desktop base (`/`) and the mobile base (`/m/`).
 */
export function assetUrl(name: string): string {
  return `${import.meta.env.BASE_URL}${name}`;
}
