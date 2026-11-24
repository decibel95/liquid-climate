/**
 * Pixel baseline only: no animations, no transitions, no caret. Every shadow root gets the rule,
 * because the page stylesheet does not reach into the cards. Import this before the cards, so it
 * patches attachShadow first (the same trick as media-focus.ts, which the media page uses).
 */
export const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

const original = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init: ShadowRootInit) {
  const root = original.call(this, init);
  const style = document.createElement('style');
  style.setAttribute('data-pixel-freeze', '');
  style.textContent = FREEZE_CSS;
  root.append(style);
  return root;
};
