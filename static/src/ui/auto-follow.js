// Transcript auto-follow: pin to bottom while the user is at the bottom,
// release the pin when they scroll up. Also drives the soft "clip" fade
// at the top of the scroll container.

import { els } from '../els.js';

export function setupAutoFollow(el) {
  if (!el) return;
  enableAutoFollow(el);
  updateClipTop(el);
  el.addEventListener('scroll', () => {
    el.dataset.autofollow = isNearBottom(el) ? 'on' : 'off';
    updateClipTop(el);
  });
}

export function enableTranscriptAutoFollow() {
  enableAutoFollow(els.sourceText);
  enableAutoFollow(els.targetText);
}

export function pinToBottomIfFollowing(el) {
  if (!el || el.dataset.autofollow === 'off') return;
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => {
    if (el.dataset.autofollow !== 'off') el.scrollTop = el.scrollHeight;
  });
}

function enableAutoFollow(el) {
  if (el) el.dataset.autofollow = 'on';
}

function updateClipTop(el) {
  el.dataset.clipTop = el.scrollTop > 0 ? 'on' : 'off';
}

function isNearBottom(el) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
}
