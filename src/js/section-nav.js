// Marks the .section-nav link of the section being read with
// aria-current="true" (styled in style.css, announced by screen readers).

const navLinks = [...document.querySelectorAll('.section-nav a[href^="#"]')];
const sections = navLinks.map((link) => document.getElementById(link.hash.slice(1)));

// A section is being read once its top has gone above this line. It sits just
// below where a nav click lands a section (scroll-margin-top: 24px), so a short
// section like Études stays active after its link is clicked instead of the one
// following it.
const READING_LINE_PX = 96;

// Certifications and Contact are too short to scroll up to the reading line,
// so a click on either would light up whatever the page bottom shows. The
// clicked link therefore stays active through the smooth scroll it triggers,
// until the visitor scrolls on their own again.
let clickedLink = null;

function setActiveLink(activeLink) {
  navLinks.forEach((link) => {
    if (link === activeLink) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
}

function updateActiveLink() {
  if (clickedLink) return;
  const isAtPageBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  // The last section is too short to reach the reading line: at the very
  // bottom of the page it is the one being read.
  let activeIndex = isAtPageBottom ? sections.length - 1 : 0;
  if (!isAtPageBottom) {
    sections.forEach((section, index) => {
      if (section && section.getBoundingClientRect().top <= READING_LINE_PX) activeIndex = index;
    });
  }
  setActiveLink(navLinks[activeIndex]);
}

navLinks.forEach((link) => link.addEventListener('click', () => {
  clickedLink = link;
  setActiveLink(link);
}));

for (const scrollInput of ['wheel', 'touchstart', 'keydown']) {
  window.addEventListener(scrollInput, () => { clickedLink = null; }, { passive: true });
}

window.addEventListener('scroll', updateActiveLink, { passive: true });
updateActiveLink();
