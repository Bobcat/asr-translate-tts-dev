// Generic bottom-sheet swipe-down-to-close gesture. Used by both the
// language picker (ui/language-sheet.js) and the settings sheet
// (settings/sheet.js).

export function setupSheetSwipeClose({ layer, sheet, scrollContainer, onClose, isAllowed }) {
  if (!layer || !sheet) return;
  const SWIPE_CLOSE_THRESHOLD_PCT = 0.40;
  let startY = null;
  let startScrollTop = 0;
  let dragging = false;
  let currentDelta = 0;
  let sheetHeight = 0;
  const onStart = (e) => {
    if (layer.hidden) return;
    if (e.touches.length !== 1) return;
    if (isAllowed && !isAllowed()) return;
    startY = e.touches[0].clientY;
    startScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    sheetHeight = sheet.getBoundingClientRect().height || 0;
    dragging = false;
    currentDelta = 0;
  };
  const onMove = (e) => {
    if (startY === null) return;
    const y = e.touches[0].clientY;
    const delta = y - startY;
    if (delta <= 0) return;
    if (startScrollTop > 0) return;
    if (scrollContainer && scrollContainer.scrollTop > 0) {
      sheet.style.removeProperty('transform');
      sheet.style.removeProperty('transition');
      dragging = false;
      return;
    }
    dragging = true;
    currentDelta = delta;
    // !important needed to beat the entry animation's fill-mode:both,
    // which otherwise keeps "transform: translateY(0)" pinned.
    sheet.style.setProperty('transition', 'none', 'important');
    sheet.style.setProperty('transform', `translateY(${delta}px)`, 'important');
    e.preventDefault();
  };
  const onEnd = () => {
    if (dragging) {
      const threshold = Math.max(40, sheetHeight * SWIPE_CLOSE_THRESHOLD_PCT);
      if (currentDelta > threshold) {
        // Animate the layer opacity together with the sheet so the scrim
        // fades instead of popping when we hide it.
        sheet.style.setProperty('transition', 'transform 0.18s ease', 'important');
        sheet.style.setProperty('transform', 'translateY(100%)', 'important');
        layer.style.setProperty('transition', 'opacity 0.18s ease', 'important');
        layer.style.setProperty('opacity', '0', 'important');
        setTimeout(() => {
          onClose();
          sheet.style.removeProperty('transform');
          sheet.style.removeProperty('transition');
          layer.style.removeProperty('opacity');
          layer.style.removeProperty('transition');
        }, 170);
      } else {
        sheet.style.setProperty('transition', 'transform 0.18s ease', 'important');
        sheet.style.setProperty('transform', 'translateY(0)', 'important');
        // Clear inline after the snap-back transition completes so the
        // entry animation can take over again on next open.
        setTimeout(() => {
          sheet.style.removeProperty('transform');
          sheet.style.removeProperty('transition');
        }, 200);
      }
    }
    startY = null;
    dragging = false;
    currentDelta = 0;
  };
  sheet.addEventListener('touchstart', onStart, { passive: true });
  sheet.addEventListener('touchmove', onMove, { passive: false });
  sheet.addEventListener('touchend', onEnd);
  sheet.addEventListener('touchcancel', onEnd);
}
