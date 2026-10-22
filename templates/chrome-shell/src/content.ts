// The page side of the browser-tab port: one generic executor over this tab's document.
import { runPageContentScript } from '@almadar/shell-chrome/content';

runPageContentScript(chrome.runtime, document, location.href);
