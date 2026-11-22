/**
 * Helpers for prerender.mjs, shared with route-documents.mjs: where a route's
 * HTML lands, and the sitemap/robots files for the routes.json manifest.
 */
export { routeFile, sitemap, robots } from './route-documents.mjs';

/**
 * Whether the page is ready to be written: its route's traits have mounted (`data-orb-mounted`, so a page with no canvas
 * yet is not taken for one with none) and every scene canvas on it has said its program laid the scene out
 * (`data-orb-ready`, set by the canvas once it has drawn a frame the program marked `ready`). Runs inside the page, so it
 * closes over nothing.
 */
export function scenesReady() {
  return document.querySelector('[data-orb-mounted]') !== null
    && [...document.querySelectorAll('.orbital-scene-canvas')].every((scene) => scene.getAttribute('data-orb-ready') === 'true');
}

/**
 * The page as the written document: a detached copy with every ready and mounted mark removed, so the document is the
 * page before it boots (its laid-out text, never the marks) and the live canvas cannot put the mark back before it is serialized.
 * Runs inside the page, so it closes over nothing.
 */
export function readySnapshot() {
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll('[data-orb-ready]').forEach((el) => el.removeAttribute('data-orb-ready'));
  root.querySelectorAll('[data-orb-mounted]').forEach((el) => el.removeAttribute('data-orb-mounted'));
  // The booting shell replaces a marked portal root's content instead of portalling beside it (portalRoot.ts).
  root.querySelector('#ui-slot-portal-root')?.setAttribute('data-orb-prerendered', '');
  return '<!DOCTYPE html>' + root.outerHTML;
}
