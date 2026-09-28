// "Drag to orbit" screen: reads pointer/keyboard input and writes each card's
// style. All geometry comes from orbit-geometry.mjs; this file only owns the
// rotation state and the animation loop.

import { ORBIT, cardPlacement, nextVelocity, rotationToFront, sphereAnchors } from "./orbit-geometry.mjs";

// Shortest signed angle from `from` to `to`, so bringing a card forward never
// spins the long way round.
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * @param {object} options
 * @param {HTMLElement} options.stageElement - The .orbit-stage (drag surface).
 * @param {HTMLElement[]} options.cardElements - Cards carrying data-opens-section.
 * @param {(sectionId: string) => void} options.onCardSelected
 * @param {() => boolean} options.isCovered - True while a layer hides the stage.
 */
export function createOrbit({ stageElement, cardElements, onCardSelected, isCovered }) {
  const orbitState = {
    rotation: { x: 0, y: 0 },
    velocity: { x: 0, y: ORBIT.idleSpeed },
    radius: 0,
    drag: null,
    suppressNextClick: false,
    focusTarget: null,
    frameId: 0,
  };

  // Clicks stay wired even without animation (reduced motion keeps the static layout).
  for (const card of cardElements) {
    card.addEventListener("click", (event) => {
      event.preventDefault();
      onCardSelected(card.dataset.opensSection);
    });
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const anchors = sphereAnchors(cardElements.length);
  stageElement.classList.add("has-orbit");

  function renderCards() {
    anchors.forEach((anchor, cardIndex) => {
      const placement = cardPlacement({ anchor, rotation: orbitState.rotation, radius: orbitState.radius });
      const cardStyle = cardElements[cardIndex].style;
      cardStyle.transform =
        `translate3d(${placement.x.toFixed(1)}px, ${placement.y.toFixed(1)}px, ${placement.z.toFixed(1)}px) ` +
        `rotateY(${placement.tiltY.toFixed(2)}deg) rotateX(${placement.tiltX.toFixed(2)}deg) scale(${placement.scale.toFixed(3)})`;
      cardStyle.filter = placement.blur > 0.1 ? `blur(${placement.blur.toFixed(1)}px)` : "none";
      cardStyle.zIndex = placement.zIndex;
      cardStyle.setProperty("--card-shade", placement.shade.toFixed(3));
    });
  }

  function advanceRotation() {
    if (orbitState.drag) return;
    if (orbitState.focusTarget) {
      orbitState.rotation.x += angleDelta(orbitState.rotation.x, orbitState.focusTarget.x) * ORBIT.focusEase;
      orbitState.rotation.y += angleDelta(orbitState.rotation.y, orbitState.focusTarget.y) * ORBIT.focusEase;
      return;
    }
    orbitState.velocity = nextVelocity(orbitState.velocity);
    orbitState.rotation.x += orbitState.velocity.x;
    orbitState.rotation.y += orbitState.velocity.y;
  }

  function onFrame() {
    orbitState.frameId = requestAnimationFrame(onFrame);
    if (isCovered()) return;
    advanceRotation();
    renderCards();
  }

  // Only animate while the screen is actually on view: nothing runs on the
  // "À propos" screen. isIntersecting is not enough: the stage sits flush
  // against the track's clipping edge there, and a zero-area edge contact
  // counts as intersecting.
  new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(orbitState.frameId);
    if (entry.intersectionRatio > 0) orbitState.frameId = requestAnimationFrame(onFrame);
  }, { threshold: 0.01 }).observe(stageElement);

  new ResizeObserver(() => {
    orbitState.radius = Math.min(stageElement.clientWidth, stageElement.clientHeight) * ORBIT.radiusRatio;
    renderCards();
  }).observe(stageElement);

  stageElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    orbitState.drag = {
      pointerId: event.pointerId,
      isTouch: event.pointerType === "touch",
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    orbitState.suppressNextClick = false;
    orbitState.focusTarget = null;
  });

  // On window, not with pointer capture: capture would retarget the click
  // that follows a simple tap to the stage instead of the card.
  window.addEventListener("pointermove", (event) => {
    const drag = orbitState.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaX = event.clientX - drag.lastX;
    // A finger's vertical move belongs to page scrolling (touch-action: pan-y).
    const deltaY = drag.isTouch ? 0 : event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > ORBIT.clickThresholdPx) {
      orbitState.suppressNextClick = true;
    }
    orbitState.velocity = { x: deltaY * ORBIT.dragRadiansPerPixel, y: deltaX * ORBIT.dragRadiansPerPixel };
    orbitState.rotation.x += orbitState.velocity.x;
    orbitState.rotation.y += orbitState.velocity.y;
  });

  const endDrag = (event) => {
    if (orbitState.drag?.pointerId === event.pointerId) orbitState.drag = null;
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  // Capture phase: a drag that ends on a card must not open it.
  stageElement.addEventListener("click", (event) => {
    if (!orbitState.suppressNextClick) return;
    orbitState.suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Cards are links: the browser's native link drag would cancel the pointer stream.
  stageElement.addEventListener("dragstart", (event) => event.preventDefault());

  cardElements.forEach((card, cardIndex) => {
    card.addEventListener("focus", () => {
      if (card.matches(":focus-visible")) orbitState.focusTarget = rotationToFront(anchors[cardIndex]);
    });
    card.addEventListener("blur", () => {
      orbitState.focusTarget = null;
      orbitState.velocity = { x: 0, y: ORBIT.idleSpeed };
    });
  });
}
