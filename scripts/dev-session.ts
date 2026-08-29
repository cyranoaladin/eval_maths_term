/**
 * scripts/dev-session.ts
 *
 * Fabrique un cookie de session enseignant pour le développement local.
 *
 * L'authentification passe par OAuth Kimi, indisponible hors production : sans
 * cela, aucune page enseignant n'est atteignable sur une machine de dev.
 *
 * Ce n'est pas un contournement d'authentification : le jeton est signé avec
 * `TEACHER_SESSION_SECRET`, que seul le détenteur du `.env` possède. Aucune
 * route de l'application ne délivre ce jeton.
 *
 * Usage : npx tsx scripts/dev-session.ts [nom] [email]
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { signSessionToken } from "../api/kimi/session";
import { getDb } from "../api/queries/connection";
import { users } from "../db/schema";
import { env } from "../api/lib/env";

const UNION_ID = "dev-teacher";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusé : ce script est réservé au développement.");
    process.exit(1);
  }

  const name = process.argv[2] ?? "Enseignant (dev)";
  const email = process.argv[3] ?? "dev@localhost";
  const db = getDb();

  const [existing] = await db.select().from(users).where(eq(users.unionId, UNION_ID)).limit(1);
  if (!existing) {
    await db.insert(users).values({ unionId: UNION_ID, name, email, role: "teacher" });
    console.log(`Utilisateur « ${name} » créé (rôle enseignant).`);
  } else {
    await db.update(users).set({ role: "teacher", name, email }).where(eq(users.id, existing.id));
    console.log(`Utilisateur « ${name} » réutilisé (rôle enseignant).`);
  }

  const token = await signSessionToken({ unionId: UNION_ID, clientId: env.appId });

  console.log("\nÀ coller dans la console du navigateur, sur http://localhost:3000 :\n");
  console.log(`document.cookie = "kimi_sid=${token}; path=/; max-age=43200"; location.href = "/teacher/evaluations";`);
  console.log("\nValidité : 12 heures.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});
