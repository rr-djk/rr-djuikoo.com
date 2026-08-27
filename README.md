# rr-djuikoo.com

Portfolio personnel avec panneau chat (agent **Wags**). Le site présente parcours, projets et certifications ; le chat répondra ensuite via une Lambda AWS + Bedrock.

> État actuel : frontend statique fonctionnel en local. Pas de backend ni d'infra déployée (`terraform/` vide, pas de `lambda/`). Le README sera enrichi à chaque jalon.

## Prérequis

- Python 3 (serveur statique local)
- [pre-commit](https://pre-commit.com/) (hooks qualité/sécurité)

## Démarrage local

```bash
make serve
# -> http://localhost:8000 (sert le dossier site/)
```

Autres commandes :

```bash
pre-commit install           # active les hooks au commit
pre-commit run --all-files   # trailing-whitespace, prettier (yaml/json/md), gitleaks, check-toml, terraform_fmt/validate/tflint
```

## Structure

```
site/              # frontend vanilla — pas de build step
  index.html       # 70% contenu (À propos, Projets, Études, Expérience, Certifications, Contact)
  css/style.css    # tokens CSS, responsive, panneau chat 30% (#F5F0E1 / #1F4D2C)
  js/main.js       # year + chat (/api/chat, sessionId par visite, readReply)
terraform/         # vide — IaC prévue (S3, CloudFront, Lambda, Bedrock)
Makefile           # cible serve
```

Le chat appelle `POST /api/chat` (`{ message, sessionId }`). Sans backend, la réponse affiche `[Namespace] Error calling the agent.` (comportement attendu).

## Stack vérifiée

| Couche        | Techno                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Frontend      | HTML/CSS/JS vanilla, Google Fonts Lora + Inter                                                       |
| Serveur local | `python3 -m http.server` via `make serve`                                                            |
| Qualité       | pre-commit (prettier, tflint), gitleaks                                                              |
| CI            | GitHub Actions `Security Scan` sur PR → `main` (Trivy HIGH/CRITICAL gate + SARIF, Semgrep, Gitleaks) |

Pas de `package.json`, pas de dépendances npm côté frontend. Le dossier `site/` contient 14 `TODO(content)` à remplir (contenu placeholder).

## Cible d'architecture

```
Navigateur → CloudFront (rr-djuikoo.com)
              ├── /, /static/* → S3 (OAC, privé)
              └── /api/*       → Lambda Function URL (RESPONSE_STREAM) → Bedrock Claude Haiku 4.5
```

Rate limiting prévu via DynamoDB (20 req / 10 min / IP). Région cible `us-east-1`.

## Licence

À définir.
