// Single source of truth for every piece of portfolio content.
//
// Consumed at build time by scripts/build-site.mjs, which renders two
// artefacts into site/: index.html (served to browsers and crawlers) and
// content.json (read from S3 at runtime by the Lambda - see agent/content.mjs).
//
// Everything here is **published publicly and is readable** at
// https://rr-djuikoo.com/content.json - keep private details out.
//
// After editing this file, run `make build` and commit the regenerated
// site/index.html and site/content.json alongside it.

export default {
  meta: {
    lang: "fr",
    title: "[Prénom Nom] — [Titre professionnel]",
    description: "[Description SEO en une phrase.]",
  },

  identity: {
    eyebrow: "[Localisation / accroche courte]",
    name: "[Prénom Nom]",
    title: "[Titre professionnel]",
    bio: ["[Bio courte — qui tu es, ce que tu fais, ce qui t'intéresse.]"],
  },

  about: {
    paragraphs: ["[Paragraphe À propos — remplace ce texte par ta présentation détaillée.]"],
  },

  projects: [
    {
      name: "rr-djuikoo.com",
      description:
        "Portfolio personnel 70/30 avec chat Wags — S3 + CloudFront OAC + Lambda Function URL + Bedrock Haiku 4.5.",
      tech: ["AWS", "Terraform", "Lambda", "CloudFront", "Bedrock"],
      links: [{ label: "Voir le site →", href: "https://rr-djuikoo.com" }],
    },
    {
      name: "Portfolio - Projets en cours",
      description:
        "Sections À propos / Projets / Études / Expérience / Certifications — contenu à compléter (TODO).",
      tech: ["HTML", "CSS", "JavaScript"],
      links: [{ label: "Voir la section →", href: "#projects" }],
    },
  ],

  education: [
    {
      degree: "Baccalauréat en Informatique et Génie Logiciel",
      org: "Université du Québec à Montréal · Montréal, Québec",
      dates: "Janvier 2025 – Août 2027",
    },
  ],

  experience: [
    {
      role: "[Poste / Formation]",
      org: "[Entreprise / Établissement]",
      descriptions: ["[Description courte du rôle ou des réalisations.]"],
      dates: "[AAAA — AAAA]",
    },
  ],

  certifications: [
    {
      name: "GitHub Advanced Security",
      org: "Microsoft",
      date: "Juillet 2026",
    },
    {
      name: "Microsoft Certified: Security, Compliance, and Identity Fundamentals (SC-900)",
      org: "Microsoft",
      date: "Juin 2026",
    },
  ],

  contact: {
    emails: [{ label: "[ton@email.com]", href: "mailto:ton@email.com" }],
    links: [
      { label: "[LinkedIn →]", href: "#" },
      { label: "[GitHub →]", href: "#" },
    ],
  },

  chat: {
    welcome: [
      "Bonjour, je suis Wags, Directeur des opérations de ce portfolio.",
      "Mon rôle : te faire gagner du temps.",
    ],
    question: "Questions sur le parcours, les projets ou les compétences de mon employeur ?",
    answer: "Je te réponds directement, clairement.",
    placeholder: "Pose ta question à Wags",
  },

  footer: {
    name: "[Ton Nom]",
  },
};
