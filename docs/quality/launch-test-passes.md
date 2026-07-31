# Passes de test P0 — phase launch

Exécution : 2026-07-31, poste local (Windows), Playwright 1.62 (projet
`mobile-safari`, émulation WebKit iPhone 13), serveur `next dev` sur
`http://127.0.0.1:3100`, base Postgres de dev (`athe-postgres-1`, catalogue
complet : 21 universités / 51 programmes), Redis `athe-redis-1`.

Suite e2e complète : **45/45 tests verts** (3 exécutions consécutives),
commande `corepack pnpm --filter @athenvia/web test:e2e`.

Nouveaux fichiers de test durables :

- `apps/web/tests/e2e/install-journey.spec.ts` (#92)
- `apps/web/tests/e2e/core-journey.spec.ts` (#93)
- `apps/web/tests/e2e/push-reminders.spec.ts` (#94)
- `apps/web/tests/e2e/contribution.spec.ts` (#95)
- Helpers : `apps/web/tests/e2e/helpers/test-env.ts` (bootstrap env, VAPID e2e,
  allowlist admin), `apps/web/tests/e2e/helpers/db.ts` (sessions NextAuth
  seedées en base, assertions et nettoyage).

Les journeys dépendant de la base se désactivent proprement (`test.skip`)
quand `DATABASE_URL` est absent : la job CI e2e actuelle (sans service
Postgres) reste verte.

Prérequis locaux : un `.env` à la racine avec `POSTGRES_DB/USER/PASSWORD`
(et éventuellement `REDIS_URL`) — le bootstrap `helpers/test-env.ts` dérive
`DATABASE_URL`/`REDIS_URL` comme `scripts/with-env.mjs` et transmet au serveur
de test l'allowlist admin (`ATHENVIA_ADMIN_EMAILS`) plus une paire VAPID e2e.
Anti-flake appliqué : hôtes `127.0.0.1` (résolution `localhost`→IPv6 instable
sous Windows), pool Prisma des workers limité (`connection_limit=2`), timeout
d'assertion 15 s (compilation à la demande de `next dev`), purge des
compteurs de rate-limit de soumission avant la passe contribution.

---

## #92 [P5-01] Landing-to-install

| Critère                                              | Preuve                                                                                                                                                                                                                                                                                                                         | Verdict                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| (a) Safari iPhone affiche la guidance d'installation | `install-journey.spec.ts` « walks an iPhone visitor… » : hero, CTA `Install Athenvia` ancré sur `#install`, 3 étapes (« share button », « Add to Home Screen », « new icon ») ; manifest `display: standalone` + icônes servies. Complète `landing.spec.ts`.                                                                   | PASS                     |
| (b) Lancement standalone → app, pas la landing       | `install-journey.spec.ts` « opens the app shell and never the marketing landing » (onboarding complété → `/home`, hero marketing absent) et « routes a first standalone launch through onboarding ». Complète `standalone.spec.ts` (matchMedia + `navigator.standalone`).                                                      | PASS (simulation CSS/JS) |
| (c) Fallback desktop utilisable, guidance adaptée    | `install-journey.spec.ts` describe « desktop fallback » (1280×900, UA macOS) : landing conservée, CTA + étapes lisibles, pas d'overflow horizontal, page Privacy accessible. La guidance reste volontairement iPhone-first (« Made for your iPhone Home Screen ») : c'est le positionnement produit, pas une variante desktop. | PASS                     |

**Reste-à-faire device (iPhone physique)** : bouton Partager réel > « Sur
l'écran d'accueil », icône/splash effectifs, lancement standalone réel depuis
l'icône (ici simulé via `display-mode: standalone` et `navigator.standalone`).

**Verdict ticket : PASS-avec-restes-device.**

---

## #93 [P5-02] First launch, search, Follow

| Critère                                            | Preuve                                                                                                                                                                                                                                                                                                                                                                                                                           | Verdict |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Onboarding → recherche → détail programme          | `core-journey.spec.ts` « completes onboarding, search, program detail and Follow in under a minute » : onboarding 2 écrans, navigation app, recherche « artificial intelligence » sur le vrai catalogue, ouverture de la carte résultat.                                                                                                                                                                                         | PASS    |
| Statut de date + source officielle compréhensibles | Libellés réels assertés (copie exacte de `publicDateCopy`, `packages/contracts/src/domain.ts:40`) : « Confirmed by the university » / « Expected date » / « Not published yet » + descriptions, sections « Applications open », « Next deadline », « Official source ».                                                                                                                                                          | PASS    |
| Follow                                             | Follow exige une session (`app/api/watchlist/route.ts:41-44`, 401 sinon). Le magic-link e-mail n'est pas automatisable : la session est seedée comme NextAuth la stocke (ligne `sessions` + cookie `next-auth.session-token`, stratégie database). Follow → « Program followed. » + ligne `user_watchlists` vérifiée en base. Le parcours anonyme est aussi couvert : « asks an anonymous visitor to sign in before following ». | PASS    |
| Temps de parcours < 1 minute                       | Parcours automatisé mesuré (annotation `journey-duration`, budget asserté 60 s) : **10,1 s / 18,2 s / 12,6 s** selon la charge du serveur dev sur 3 exécutions. Un humain qui lit les écrans reste largement sous la minute (4 écrans, 1 saisie).                                                                                                                                                                                | PASS    |

**Limite** : la connexion réelle par e-mail (réception du lien magique) reste
à valider à la main ; le pattern e2e existant (`auth.spec.ts`) ne couvre que
la réponse générique du formulaire.

**Verdict ticket : PASS.**

---

## #94 [P5-03] Permission + reminder push

| Critère                                               | Preuve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| (a) Prompt permission uniquement sur action explicite | `push-reminders.spec.ts` « never requests notification permission while browsing » : `Notification.requestPermission` instrumenté, 0 appel sur `/`, `/onboarding`, `/home`, `/search`. « registers the push subscription only after… » : le panneau d'offre post-Follow ne déclenche rien ; compteur = 0 avant le clic « Turn on reminders », = 1 après. Sur iPhone Safari non installé : panneau « Install Athenvia for reminders » (pas de prompt possible).                                                                                                                                         | PASS                      |
| (b) Reminder livré une seule fois                     | Couvert par la suite worker existante : `apps/worker/src/notification-delivery.test.ts:397` (« dispatches due IDs with jobId dedupe and attempts fixed to one »), `:443` (« allows two concurrent jobs to claim once and send once ») ; `apps/worker/src/notifications/scheduler.test.ts:150` et `:189` (ligne pending stable, réactivation sans doublon) ; contrainte `dedupe_key @unique` sur `notification_deliveries`. Ajout e2e : chemin UI → subscription enregistrée (POST `/api/push/subscriptions` 204, clé VAPID serveur vérifiée côté client, ligne `push_subscriptions` vérifiée en base). | PASS                      |
| (c) La notification ouvre le bon programme            | Lecture de `apps/web/public/sw-notifications.js:77-120` (handler `notificationclick` : focus d'un onglet déjà sur `/programs/[id]`, sinon `navigate`, sinon `openWindow`) + test e2e « verifies the notification click handler only opens program deep links » qui exécute le fichier livré et vérifie le garde-fou `safeProgramDeepLink` (UUID exigé, refus des URL absolues, query, backslash, autres routes).                                                                                                                                                                                       | PASS (logique de ciblage) |

**Reste-à-faire device** : réception réelle d'un push (APNs/WebPush) sur un
iPhone installé, affichage de la notification et ouverture effective de
l'app sur le bon programme au tap.

**Verdict ticket : PASS-avec-restes-device.**

---

## #95 [P5-04] Contribution d'université

| Critère                                                | Preuve                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Verdict |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Soumission d'une université inconnue via le formulaire | **FAIL — défaut n°1 ci-dessous.** Le formulaire n'appelle jamais l'API : toute soumission affiche « Submissions aren't available yet ». Test encodant le comportement attendu conservé avec `test.fail()` (« lets a signed-in student send an unknown university from the form ») : il signalera « passed unexpectedly » dès que le câblage sera fait.                                                                                                                        | FAIL    |
| États worker/review visibles côté admin                | Pipeline complet via le contrat API (session étudiante réelle) : POST `/api/university-submissions` → 201 `pending_review` ; `/admin` (session admin allowlistée via `ATHENVIA_ADMIN_EMAILS`) affiche la carte `UNIVERSITY SUBMISSION / submissionReview / Pending` avec la valeur proposée ; la revue `duplicate_candidates` créée par « Athenvia verification worker » est également affichée (voir défaut n°2 sur la provenance). Accès contrôlé : compte non admin → 404. | PASS    |
| L'approbation rend l'enregistrement réutilisable       | Approve dans l'UI admin → statut `APPROVED` en base ; publication POST `/api/admin/publications/university/[id]` → `outcome: PUBLISHED`, ligne `universities` `ACTIVE` ; **réutilisation prouvée** : une nouvelle soumission du même nom déclenche la détection de doublon contre l'enregistrement publié (revue `duplicate_candidates` contenant son id).                                                                                                                    | PASS    |

**Étapes manuelles documentées** :

1. La publication post-approbation n'a pas de bouton dans l'UI admin : elle
   se fait par `POST /api/admin/publications/university/<submissionId>`
   (session admin + header `Origin`). Exécuté et vérifié dans le test.
2. Une université publiée sans programme n'apparaît pas dans la recherche
   produit (la recherche exige un programme actif avec résumé officiel,
   `apps/web/app/api/search/catalogue-search.ts:69-82`) : la réutilisation
   passe par la détection de doublons et, à terme, la contribution de
   programmes rattachés.

**Verdict ticket : FAIL (formulaire) / PASS (pipeline review-approbation-publication).**

---

## Défauts découverts

1. **[MAJEUR] Le formulaire de contribution ne soumet jamais rien.**
   `apps/web/app/(app)/contribute/university/missing-university-form.tsx:70`
   appelle `submitMissingUniversity(parsedSubmission.data)` sans transport ;
   `apps/web/app/(app)/contribute/university/submission.ts:60-71` retombe sur
   `unavailableTransport` qui répond toujours `{ status: "unavailable" }`.
   L'API `POST /api/university-submissions` existe et fonctionne (prouvé par
   e2e) mais l'UI affiche systématiquement « Submissions aren't available
   yet ». Même motif côté programme :
   `apps/web/app/(app)/contribute/program/submission.ts:90-100`. Correction
   attendue : injecter un transport `fetch` vers l'API (avec gestion 401/429).

2. **[MOYEN] Provenance erronée dans la file de review.**
   `packages/database/src/submission-reviews.ts:16` crée la révision avec
   `createdByWorker: true` et sans `createdByUserId` ; l'UI admin
   (`apps/web/app/api/admin/reviews/service.ts:60-62`) affiche donc
   « Proposed by Athenvia verification worker » pour une soumission étudiante.
   Le contributeur n'apparaît que comme UUID brut dans le JSON proposé.

3. **[MINEUR] Feedback de décision perdu sur la dernière carte.**
   `apps/web/app/admin/review-queue.tsx:43-50` : quand la carte
   approuvée/rejetée était la dernière, le composant bascule sur l'état
   « Queue clear » et le message aria-live « Revision approved and audited. »
   n'est jamais rendu.

4. **[OBSERVATION] Drift schéma/migration.**
   `packages/database/prisma/schema.prisma` déclare
   `DataRevision.createdBy … onDelete: SetNull` alors que la migration
   `20260730180000_revision_conflict_guards` a durci la contrainte en
   `ON DELETE RESTRICT`. Un futur `prisma migrate dev` risque de régénérer un
   retour en arrière silencieux. Aligner le schéma sur la contrainte réelle.

5. **[OBSERVATION] `data_revisions` est append-only côté base** (trigger
   `protect_data_revision_history`) : tout nettoyage de fixtures doit passer
   par des décisions REJECTED, jamais par des DELETE (pris en compte dans
   `tests/e2e/helpers/db.ts`).

---

## Validation

- `corepack pnpm typecheck` : OK (database, web, worker).
- `corepack pnpm lint` : OK.
- `corepack pnpm format:check` : OK.
- E2e : 45/45 verts (2 runs complets), dont les 15 nouveaux tests.

## Reste strictement device-only (iPhone physique)

1. Installation réelle : Safari > Partager > Sur l'écran d'accueil, icône et
   splash screen.
2. Lancement standalone réel depuis l'icône (ici simulé).
3. Prompt de permission natif iOS (≥ 16.4, app installée) et réception d'un
   vrai push : notification visible, tap → ouverture de l'app sur
   `/programs/<id>`.
4. Envoi/réception du magic-link sur boîte mail réelle.
