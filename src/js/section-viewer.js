// Pop-up window presenting one portfolio section at a time. Sole owner of its
// own state: the rest of the page only goes through open/close/isOpen.

/**
 * @param {object} options
 * @param {HTMLElement} options.viewerElement - The .section-viewer, a child of
 *   .main-panel, preceded by its .section-backdrop.
 * @param {() => boolean} options.isCoveredByChat - True while the chat layer sits on top.
 * @returns {{ open: (sectionId: string) => void, close: () => void, isOpen: () => boolean }}
 */
export function createSectionViewer({ viewerElement, isCoveredByChat }) {
  const sectionsById = new Map(
    [...viewerElement.querySelectorAll('.section')].map((section) => [section.id, section]),
  );
  const backdropElement = viewerElement.previousElementSibling;
  const mainPanel = viewerElement.parentElement;
  let openSectionId = null;
  let focusBeforeOpen = null;

  // Without this class the viewer stays a plain stacked block (no-JS fallback).
  document.documentElement.classList.add('has-section-viewer');
  for (const section of sectionsById.values()) section.hidden = true;

  // The only place viewer state changes, so it can never be left half-open.
  function setViewerState(sectionId) {
    const isShown = sectionId !== null;
    openSectionId = sectionId;
    viewerElement.classList.toggle('is-open', isShown);
    backdropElement.hidden = !isShown;
    document.documentElement.classList.toggle('is-viewer-open', isShown);
    for (const [id, section] of sectionsById) section.hidden = id !== sectionId;
    // Siblings rather than .main-panel itself, which contains the viewer (and
    // the backdrop, which must stay clickable). Read at call time: GSAP's pin
    // wraps the horizontal track in a new element.
    for (const sibling of mainPanel.children) {
      if (sibling !== viewerElement && sibling !== backdropElement) sibling.inert = isShown;
    }
    if (isShown) {
      const title = sectionsById.get(sectionId).querySelector('.section-title');
      viewerElement.setAttribute('aria-label', title.textContent);
      title.focus();
    }
  }

  function open(sectionId) {
    if (openSectionId === null) focusBeforeOpen = document.activeElement;
    setViewerState(sectionId);
  }

  function close() {
    if (openSectionId === null) return;
    setViewerState(null);
    focusBeforeOpen?.focus();
    focusBeforeOpen = null;
  }

  viewerElement.querySelector('.viewer-close').addEventListener('click', close);
  backdropElement.addEventListener('click', close);
  // Capture phase: runs before the chat's own Escape handler, so while the chat
  // is still open the viewer knows it is covered and leaves Escape to the chat.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openSectionId !== null && !isCoveredByChat()) close();
  }, true);

  return { open, close, isOpen: () => openSectionId !== null };
}
