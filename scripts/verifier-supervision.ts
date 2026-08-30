/**
 * scripts/verifier-supervision.ts
 *
 * Envoie une erreur de vérification à la supervision, et rend compte.
 *
 * Une supervision qu'on n'a jamais vue fonctionner n'est pas une supervision.
 * Ce script produit un événement reconnaissable, attend qu'il parte, et dit
 * quoi chercher dans la console du collecteur. À lancer après chaque
 * déploiement, sur la machine qui vient d'être déployée.
 *
 *   SENTRY_DSN=<dsn> npx tsx scripts/verifier-supervision.ts
 *
 * L'événement ne contient aucune donnée d'élève : il traverse le même nettoyage
 * que les autres, et le script le vérifie avant l'envoi.
 */
import "dotenv/config";
import { env } from "../api/lib/env";
import { EMPREINTE_GIT, VERSION_APPLICATION } from "../api/lib/version";
import {
  initialiserSupervision,
  nettoyerValeur,
  signalerErreur,
  supervisionActive,
  viderLaFileDeSupervision,
} from "../api/lib/supervision";

async function main() {
  if (!env.sentryDsn) {
    console.log(
      "SENTRY_DSN n'est pas renseignée : les erreurs restent dans le journal du\n" +
        "serveur, et nulle part ailleurs. C'est un choix possible pour un\n" +
        "déploiement isolé ; ce n'en est un que s'il est délibéré.",
    );
    process.exit(1);
  }

  initialiserSupervision();
  if (!supervisionActive()) {
    console.error("La supervision n'a pas démarré malgré une adresse configurée.");
    process.exit(1);
  }

  const marqueur = `verification-${Date.now()}`;
  const donnees = {
    marqueur,
    version: VERSION_APPLICATION,
    gitSha: EMPREINTE_GIT,
    environnement: env.nodeEnv,
    // Volontairement présents : on veut voir le nettoyage à l'œuvre.
    sessionToken: "eyJhbGciOiJIUzI1NiJ9.charge.utile",
    studentName: "Ne doit pas apparaître",
  };

  const apresNettoyage = nettoyerValeur(donnees) as Record<string, unknown>;
  const fuite =
    JSON.stringify(apresNettoyage).includes("eyJ") ||
    JSON.stringify(apresNettoyage).includes("Ne doit pas apparaître");
  if (fuite) {
    console.error("Le nettoyage laisse passer une donnée : envoi annulé.");
    process.exit(1);
  }
  console.log("✓ Le nettoyage retire le jeton et le nom d'élève.");

  signalerErreur(`Vérification de la supervision — ${marqueur}`, donnees);
  await viderLaFileDeSupervision(10_000);

  console.log(`✓ Événement envoyé.\n`);
  console.log(`  Cherchez « ${marqueur} » dans la console du collecteur.`);
  console.log(
    `  Il doit porter la version ${VERSION_APPLICATION} et l'empreinte ${EMPREINTE_GIT},\n` +
      "  et ne contenir ni jeton, ni nom d'élève.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});
