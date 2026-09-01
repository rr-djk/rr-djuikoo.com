# rr-djuikoo.com

Portfolio personnel avec panneau chat (agent **Wags**). Le site présente parcours, projets et certifications ; le chat répondra ensuite via une Lambda AWS + Bedrock.

> État actuel : frontend statique fonctionnel en local. L'IaC Terraform est amorcée
> (bucket d'état S3 `rr-djuikoo-tf-state`, backends S3 configurés) mais aucune
> ressource applicative n'est encore déployée (pas de `lambda/`). Le README sera
> enrichi à chaque jalon.

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
terraform/
  bootstrap/       # config du bucket d'état Terraform (rr-djuikoo-tf-state) - state sur S3
  *.tf             # stack applicative - backend S3, pas encore de ressource (S3, CloudFront, Lambda, Bedrock à venir)
Makefile           # cible serve
```

Le chat appelle `POST /api/chat` (`{ message, sessionId }`). Sans backend, la réponse affiche `[Namespace] Error calling the agent.` (comportement attendu).

## Notes Infrastructure

> **Important** : la mise à jour de l'infrastructure AWS n'est gérée par aucun
> workflow CI/CD. Les commandes Terraform (`init`, `plan`, `apply`, etc.) sont
> lancées en local lorsque nécessaire. L'infrastructure actuelle étant figée
> (aucune modification prévue à court terme), cette approche manuelle est
> suffisante.

## Stack vérifiée

| Couche        | Techno                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | HTML/CSS/JS vanilla, Google Fonts Lora + Inter                                                                                   |
| Serveur local | `python3 -m http.server` via `make serve`                                                                                        |
| Qualité       | pre-commit (prettier, tflint), gitleaks                                                                                          |
| CI            | GitHub Actions `Security Scan` sur PR → `main` (Trivy HIGH/CRITICAL gate + SARIF, Semgrep, Gitleaks, Checkov sur `terraform/**`) |

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
