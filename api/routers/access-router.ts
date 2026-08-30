/**
 * api/routers/access-router.ts
 *
 * Autorisation des comptes, réservée aux administrateurs.
 *
 * Sans cet écran, la fermeture de l'accès par défaut serait une impasse : un
 * enseignant qui se connecte pour la première fois arrive « en attente », et
 * personne ne pourrait l'autoriser.
 */
import { z } from "zod";
import { asc, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, createRouter } from "../middleware";
import { getDb } from "../queries/connection";
import { definirAcces } from "../queries/users";
import { users } from "@db/schema";
import { messageDErreur } from "@contracts/erreurs";

const RoleSchema = z.enum(["student", "teacher", "admin"]);
const StatutSchema = z.enum(["pending", "active", "disabled"]);

export const accessRouter = createRouter({
  /** Les comptes, ceux en attente d'abord : c'est ce qu'on vient traiter. */
  listUsers: adminQuery.query(async () => {
    const rows = await getDb()
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        lastSignInAt: users.lastSignInAt,
      })
      .from(users)
      .orderBy(asc(users.status), desc(users.lastSignInAt));

    return rows.map((u) => ({
      ...u,
      // L'identifiant du fournisseur OAuth n'a rien à faire dans une interface.
      enAttente: u.status === "pending",
    }));
  }),

  setAccess: adminQuery
    .input(
      z.object({
        userId: z.number().int().positive(),
        role: RoleSchema,
        status: StatutSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id && (input.role !== "admin" || input.status !== "active")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "On ne se retire pas soi-même ses propres droits.",
        });
      }
      try {
        await definirAcces(input.userId, input.role, input.status);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: messageDErreur(e, "Modification refusée"),
        });
      }
      return { ok: true };
    }),
});
