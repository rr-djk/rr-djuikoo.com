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
    eyebrow: "Montréal, QC",
    name: "[Prénom Nom]",
    title: "[Titre professionnel]",
    bio: ["[Bio courte — qui tu es, ce que tu fais, ce qui t'intéresse.]"],
  },

  about: {
    paragraphs: ["[Paragraphe À propos — remplace ce texte par ta présentation détaillée.]"],
  },

  projects: [
    {
      name: "MyAm",
      descriptions: [
        "Application mobile qui déchiffre les étiquettes alimentaires : on scanne un produit, elle en extrait la composition et alerte sur les allergènes selon le profil de la personne, ses intolérances et son régime.",
        "Projet universitaire mené à cinq, au sein duquel j'ai pris en charge l'authentification des utilisateurs et une partie de la protection des données.",
        "J'ai également livré la fonctionnalité d'historique des scans, avec l'enregistrement sur l'appareil, leur consultation et leur export,, ainsi que l'onglet de lecture d'étiquette, tests compris.",
        "Enfin, j'ai repris la chaîne de build de l'équipe : correction d'une trentaine de vulnérabilités héritées de nos dépendances, détection automatique des suivantes, et parallélisation des étapes de compilation.",
      ],
      tech: ["Flutter", "Spring Boot", "Java", "PostgreSQL", "Docker", "GitHub Actions"],
      links: [{ label: "Voir sur GitHub →", href: "https://github.com/MyAm-org/MyAm" }],
    },
    {
      name: "rr-djuikoo.com",
      descriptions: [
        "Le site que vous lisez, et l'assistant qui l'accompagne : il répond en direct aux questions sur mon parcours, mes projets et mes compétences.",
        "Tout ce qui le fait tourner, comme l'hébergement, le certificat, le nom de domaine et la base de données, est décrit dans du code versionné. Je peux détruire l'ensemble et le reconstruire à l'identique en une commande.",
        "Rien ne part en ligne à la main : chaque modification passe par quatre analyses de sécurité automatiques, puis par une vérification que le contenu publié est bien celui qui a été testé.",
      ],
      tech: ["AWS", "Terraform", "CloudFront", "Lambda", "DynamoDB", "Bedrock"],
      links: [{ label: "Voir sur GitHub →", href: "https://github.com/rr-djk/rr-djuikoo.com" }],
    },
    {
      name: "GaugeInfra",
      descriptions: [
        "Outil qui répond à une question qu'on se pose d'habitude trop tard : combien va coûter cette infrastructure une fois en ligne ? Il lit le code d'infrastructure et estime la facture mensuelle avant tout déploiement.",
        "Les montants sont calculés par du code déterministe, à partir des tarifs publiés par AWS. L'intelligence artificielle n'intervient qu'ensuite, sur des chiffres déjà établis, pour commenter les compromis entre coût et robustesse.",
        "Projet toujours en cours de développement : l'analyseur de code est terminé et couvert par 164 tests, le calcul des coûts est en chantier et l'interface reste à faire.",
      ],
      tech: ["Python", "Terraform", "AWS", "Bedrock"],
      links: [{ label: "Voir sur GitHub →", href: "https://github.com/rr-djk/GaugeInfra" }],
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
