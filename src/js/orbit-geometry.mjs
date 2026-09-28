// Pure geometry of the "Drag to orbit" screen: no DOM, no clock, so every
// rule here is unit-tested in tests/orbit-geometry.test.mjs. orbit.js reads
// input and writes the DOM; it never computes a position itself.

const DEGREE = Math.PI / 180;

export const ORBIT = {
  // Stage-relative: radius = min(stage width, stage height) × radiusRatio.
  radiusRatio: 0.34,
  // Anchors avoid the poles: a card there would sit on the central bubble.
  cardLatitude: 22 * DEGREE,
  minScale: 0.3,
  maxScale: 1,
  maxBlurPx: 6,
  maxShade: 0.45,
  // Per frame. The idle spin is what velocity decays toward once released.
  damping: 0.95,
  idleSpeed: 0.0015,
  dragRadiansPerPixel: 0.005,
  clickThresholdPx: 5,
  // A card tilts with its position on the sphere, capped so it stays readable.
  tiltFactor: 0.35,
  maxTiltDegrees: 30,
  // Share of the remaining angle covered each frame when bringing a card forward.
  focusEase: 0.12,
};

/**
 * Fixed points on the sphere: even longitudes, latitudes alternating ±cardLatitude.
 * @param {number} cardCount
 * @returns {{ theta: number, phi: number }[]} Angles in radians.
 */
export function sphereAnchors(cardCount) {
  return Array.from({ length: cardCount }, (_, cardIndex) => ({
    theta: (cardIndex * 2 * Math.PI) / cardCount,
    phi: (cardIndex % 2 === 0 ? 1 : -1) * ORBIT.cardLatitude,
  }));
}

const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

/**
 * Where a card sits once the whole sphere is rotated (around Y, then X), and
 * how deep it looks. World axes: x right, y up, z toward the viewer.
 * @param {object} options
 * @param {{ theta: number, phi: number }} options.anchor
 * @param {{ x: number, y: number }} options.rotation - Sphere rotation in radians.
 * @param {number} options.radius - In pixels.
 * @returns {{ x: number, y: number, z: number, depth: number, scale: number,
 *   blur: number, shade: number, zIndex: number, tiltY: number, tiltX: number }}
 *   x/y in CSS pixels (y pointing down), depth 0 (back) to 1 (front), tilts in degrees.
 */
export function cardPlacement({ anchor, rotation, radius }) {
  const pointX = Math.cos(anchor.phi) * Math.sin(anchor.theta);
  const pointY = Math.sin(anchor.phi);
  const pointZ = Math.cos(anchor.phi) * Math.cos(anchor.theta);

  const afterYx = pointX * Math.cos(rotation.y) + pointZ * Math.sin(rotation.y);
  const afterYz = -pointX * Math.sin(rotation.y) + pointZ * Math.cos(rotation.y);
  const afterXy = pointY * Math.cos(rotation.x) - afterYz * Math.sin(rotation.x);
  const afterXz = pointY * Math.sin(rotation.x) + afterYz * Math.cos(rotation.x);

  const depth = (afterXz + 1) / 2;
  const tiltLimit = ORBIT.maxTiltDegrees;
  return {
    x: afterYx * radius,
    y: -afterXy * radius,
    z: afterXz * radius,
    depth,
    scale: ORBIT.minScale + (ORBIT.maxScale - ORBIT.minScale) * depth,
    blur: ORBIT.maxBlurPx * (1 - depth),
    shade: ORBIT.maxShade * (1 - depth),
    zIndex: Math.round(depth * 100),
    tiltY: clamp((Math.asin(afterYx) / DEGREE) * ORBIT.tiltFactor, tiltLimit),
    tiltX: clamp((Math.asin(afterXy) / DEGREE) * ORBIT.tiltFactor, tiltLimit),
  };
}

/**
 * One frame of inertia: the horizontal spin eases toward the idle speed in
 * its current direction, the vertical one toward zero. Never flips direction.
 * @param {{ x: number, y: number }} velocity - Radians per frame.
 * @returns {{ x: number, y: number }}
 */
export function nextVelocity(velocity) {
  const idle = Math.sign(velocity.y || 1) * ORBIT.idleSpeed;
  return {
    x: velocity.x * ORBIT.damping,
    y: idle + (velocity.y - idle) * ORBIT.damping,
  };
}

/**
 * The sphere rotation that brings this anchor dead center, facing the viewer.
 * @param {{ theta: number, phi: number }} anchor
 * @returns {{ x: number, y: number }}
 */
export function rotationToFront(anchor) {
  return { x: anchor.phi, y: -anchor.theta };
}
