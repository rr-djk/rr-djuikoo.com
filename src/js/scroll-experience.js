// Turns the CV section into a single horizontal track: normal vertical
// scroll input drives horizontal movement through pinned panels.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
// Mobile browsers resize the viewport when the address bar hides/shows;
// without this, that resize re-triggers ScrollTrigger's refresh and the pin
// jumps mid-scroll.
ScrollTrigger.config({ ignoreMobileResize: true });

// GSAP tweens set inline transforms directly, so the blanket
// `* { transition: none !important }` reduced-motion rule in style.css can't
// stop this effect — the opt-out has to happen here instead.
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const wrapper = document.querySelector(".horizontal-wrapper");
  const track = document.querySelector(".horizontal-track");

  if (wrapper && track) {
    // Only switch the CSS into horizontal-panel layout once GSAP is actually
    // driving it — the base layout stays a safe vertical stack otherwise.
    document.documentElement.classList.add("has-horizontal-scroll");

    const progressBar = document.querySelector(".scroll-progress");
    const distance = () => track.scrollWidth - wrapper.clientWidth;

    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: "none",
      scrollTrigger: {
        trigger: wrapper,
        start: "top top",
        end: () => `+=${distance()}`,
        scrub: 1,
        pin: true,
        invalidateOnRefresh: true,
        onUpdate(self) {
          if (progressBar) progressBar.style.transform = `scaleX(${self.progress})`;
        },
      },
    });

    // A plain #hash anchor jump lands on the wrapper's pinned position, not
    // on where a given panel sits along its horizontal travel — the nav links
    // have to drive the page's vertical scroll position instead.
    document.querySelectorAll('.section-nav a[href^="#"]').forEach((link) => {
      const target = track.querySelector(link.getAttribute("href"));
      if (!target) return;

      link.addEventListener("click", (e) => {
        e.preventDefault();
        const { start, end } = tween.scrollTrigger;
        // Not target.offsetLeft: with no positioned ancestor, that resolves
        // against <body>, not against the track. The rect delta stays correct
        // regardless of the track's current translateX (both rects shift by
        // the same amount).
        const offsetInTrack = target.getBoundingClientRect().left - track.getBoundingClientRect().left;
        const progress = offsetInTrack / distance();
        gsap.to(window, {
          duration: 0.6,
          scrollTo: start + progress * (end - start),
          ease: "power2.inOut",
        });
      });
    });
  }
}
