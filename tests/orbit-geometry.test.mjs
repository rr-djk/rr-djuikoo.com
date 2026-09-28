// Exercises the geometry of the "Drag to orbit" screen: where each card sits
// on the rotated sphere and how deep it looks. orbit.js only applies these
// numbers to the DOM, which is why the rules live in their own pure module.
//
// No browser, no network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ORBIT,
  cardPlacement,
  nextVelocity,
  rotationToFront,
  sphereAnchors,
} from "../src/js/orbit-geometry.mjs";

const RADIUS = 250;
const anchors = sphereAnchors(5);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);

describe("les ancres sur la sphère", () => {
  it("donne cinq points distincts, loin des pôles", () => {
    assert.equal(anchors.length, 5);
    assert.equal(new Set(anchors.map((anchor) => anchor.theta)).size, 5);
    for (const anchor of anchors) assert.ok(Math.abs(anchor.phi) <= ORBIT.cardLatitude);
  });
});

describe("la place d'une carte", () => {
  it("amenée devant, elle est au centre, pleine taille, nette et au premier plan", () => {
    for (const anchor of anchors) {
      const front = cardPlacement({ anchor, rotation: rotationToFront(anchor), radius: RADIUS });
      near(front.x, 0);
      near(front.y, 0);
      near(front.z, RADIUS);
      near(front.scale, ORBIT.maxScale);
      near(front.blur, 0);
      near(front.shade, 0);
      assert.equal(front.zIndex, 100);
    }
  });

  it("au fond, elle est réduite, floue et assombrie, derrière le cercle central", () => {
    // Y is applied before X, so the exact back is not just the front turned by π.
    const anchor = anchors[1];
    const back = cardPlacement({ anchor, rotation: { x: -anchor.phi, y: Math.PI - anchor.theta }, radius: RADIUS });
    near(back.z, -RADIUS);
    near(back.scale, ORBIT.minScale);
    near(back.blur, ORBIT.maxBlurPx);
    near(back.shade, ORBIT.maxShade);
    assert.ok(back.zIndex < 50, "le cercle central est à z-index 50");
  });

  it("empile les cartes dans l'ordre de leur profondeur", () => {
    const rotation = { x: 0.4, y: 1.1 };
    const placed = anchors.map((anchor) => cardPlacement({ anchor, rotation, radius: RADIUS }));
    const byDepth = [...placed].sort((a, b) => a.z - b.z);
    for (let i = 1; i < byDepth.length; i += 1) {
      assert.ok(byDepth[i].zIndex >= byDepth[i - 1].zIndex);
      assert.ok(byDepth[i].scale >= byDepth[i - 1].scale);
    }
  });

  it("garde toutes les cartes sur la sphère et leur inclinaison bornée", () => {
    const rotation = { x: 2.3, y: -0.7 };
    for (const anchor of anchors) {
      const placed = cardPlacement({ anchor, rotation, radius: RADIUS });
      near(Math.hypot(placed.x, placed.y, placed.z), RADIUS);
      assert.ok(Math.abs(placed.tiltX) <= ORBIT.maxTiltDegrees);
      assert.ok(Math.abs(placed.tiltY) <= ORBIT.maxTiltDegrees);
    }
  });
});

describe("l'inertie", () => {
  it("ralentit un lancer vers la rotation au repos, sans changer de sens", () => {
    for (const direction of [1, -1]) {
      let velocity = { x: 0.08 * direction, y: 0.2 * direction };
      for (let frame = 0; frame < 300; frame += 1) {
        const next = nextVelocity(velocity);
        assert.ok(Math.abs(next.y) <= Math.abs(velocity.y));
        assert.equal(Math.sign(next.y), direction);
        assert.equal(Math.sign(next.x) || direction, direction);
        velocity = next;
      }
      assert.ok(Math.abs(velocity.x) < 1e-5);
      assert.ok(Math.abs(velocity.y - direction * ORBIT.idleSpeed) < 1e-5);
    }
  });

  it("met en route la rotation au repos quand tout est immobile", () => {
    const started = nextVelocity({ x: 0, y: 0 });
    assert.ok(started.y > 0 && started.y <= ORBIT.idleSpeed);
  });
});
