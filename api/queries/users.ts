/**
 * api/queries/users.ts
 *
 * Provisionnement des comptes.
 *
 * Le rôle et l'autorisation d'accès sont décidés ici, et nulle part ailleurs :
 * ni le client, ni le fournisseur OAuth ne les proposent. C'est le point qui
 * était ouvert — `users.role` avait `teacher` pour défaut, et toute personne
 * capable d'ouvrir une session chez le fournisseur devenait enseignante à sa
 * première connexion.
 */
import { and, eq, ne } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

/** Ce que le fournisseur OAuth nous apprend d'une personne. Rien de plus. */
export interface ProfilOAuth {
  unionId: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
}

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

/**
 * Enregistre le passage d'une personne authentifiée par le fournisseur OAuth.
 *
 * À la première connexion, le compte est créé sans aucun droit : `student` et
 * `pending`. Il existe, un administrateur le voit, et il n'ouvre rien. Seul le
 * propriétaire déclaré par `OWNER_UNION_ID` est provisionné administrateur —
 * autrement, une installation neuve n'aurait personne pour autoriser le premier
 * enseignant.
 *
 * Aux connexions suivantes, seuls le profil affiché et la date de passage sont
 * rafraîchis. Ni le rôle ni le statut ne sont retouchés : une révocation ne doit
 * pas être défaite par une reconnexion.
 */
export async function enregistrerConnexion(profil: ProfilOAuth) {
  const db = getDb();
  const estProprietaire =
    env.ownerUnionId !== "" && profil.unionId === env.ownerUnionId;

  const existant = await findUserByUnionId(profil.unionId);

  if (!existant) {
    await db.insert(schema.users).values({
      unionId: profil.unionId,
      name: profil.name ?? null,
      email: profil.email ?? null,
      avatar: profil.avatar ?? null,
      role: estProprietaire ? "admin" : "student",
      status: estProprietaire ? "active" : "pending",
      lastSignInAt: new Date(),
    });
    logger.info("[acces] Compte créé", {
      unionId: profil.unionId,
      role: estProprietaire ? "admin" : "student",
      statut: estProprietaire ? "active" : "pending",
    });
    return;
  }

  await db
    .update(schema.users)
    .set({
      name: profil.name ?? existant.name,
      email: profil.email ?? existant.email,
      avatar: profil.avatar ?? existant.avatar,
      lastSignInAt: new Date(),
    })
    .where(eq(schema.users.id, existant.id));

  // Le propriétaire déclaré ne peut pas rester enfermé dehors : si la variable
  // est renseignée après coup, sa prochaine connexion le rétablit.
  if (estProprietaire && (existant.role !== "admin" || existant.status !== "active")) {
    await db
      .update(schema.users)
      .set({ role: "admin", status: "active" })
      .where(eq(schema.users.id, existant.id));
    logger.info("[acces] Propriétaire rétabli administrateur", {
      unionId: profil.unionId,
    });
  }
}

/**
 * Change les droits d'un compte. Réservé aux administrateurs par la procédure
 * qui l'appelle ; la garantie qui compte est ici : on refuse de retirer le
 * dernier accès administrateur actif, sans quoi l'installation deviendrait
 * ingouvernable.
 */
export async function definirAcces(
  cible: number,
  role: "student" | "teacher" | "admin",
  statut: "pending" | "active" | "disabled",
): Promise<void> {
  const db = getDb();
  const [utilisateur] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, cible))
    .limit(1);
  if (!utilisateur) throw new Error("Compte introuvable");

  const perdSonAdministration =
    utilisateur.role === "admin" &&
    utilisateur.status === "active" &&
    (role !== "admin" || statut !== "active");

  if (perdSonAdministration) {
    const autres = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, "admin"),
          eq(schema.users.status, "active"),
          ne(schema.users.id, cible),
        ),
      )
      .limit(1);
    if (autres.length === 0) {
      throw new Error(
        "C'est le dernier administrateur actif : nommez-en un autre avant de retirer celui-ci.",
      );
    }
  }

  await db
    .update(schema.users)
    .set({ role, status: statut })
    .where(eq(schema.users.id, cible));

  logger.info("[acces] Droits modifiés", { cible, role, statut });
}
