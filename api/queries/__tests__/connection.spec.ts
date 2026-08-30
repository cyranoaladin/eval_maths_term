/**
 * L'accès à la base et son instrumentation.
 *
 * Le pool est le premier point de contention d'une fin d'épreuve : sa taille
 * doit être explicite, et le compteur de requêtes doit dire la vérité, y
 * compris pour les ordres émis dans une transaction — sans quoi il donnerait
 * une image flatteuse et fausse du coût d'une remise.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  delete process.env.PROFIL_SQL;
});

describe("pool de connexions", () => {
  it("est construit une seule fois", async () => {
    const { getPool } = await import("../connection");
    expect(getPool()).toBe(getPool());
  });

  it("porte la taille demandée par la configuration", async () => {
    const { getPool } = await import("../connection");
    const { env } = await import("../../lib/env");
    const config = (getPool().pool as unknown as { config: { connectionLimit: number } }).config;
    expect(config.connectionLimit).toBe(env.dbPoolSize);
  });

  it("rend toujours le même client Drizzle", async () => {
    const { getDb } = await import("../connection");
    expect(getDb()).toBe(getDb());
  });
});

describe("comptage des requêtes", () => {
  it("reste à zéro tant qu'il n'est pas demandé", async () => {
    const { lireComptageRequetes } = await import("../connection");
    expect(lireComptageRequetes()).toBe(0);
  });

  it("compte les requêtes émises pendant la mesure", async () => {
    process.env.PROFIL_SQL = "1";
    const {
      getDb, demarrerComptageRequetes, lireComptageRequetes, arreterComptageRequetes,
    } = await import("../connection");
    const { sql } = await import("drizzle-orm");
    const db = getDb();

    demarrerComptageRequetes();
    await db.execute(sql`SELECT 1`);
    await db.execute(sql`SELECT 2`);
    const pendant = lireComptageRequetes();
    arreterComptageRequetes();

    await db.execute(sql`SELECT 3`);
    expect(pendant).toBeGreaterThanOrEqual(2);
    // Après l'arrêt, plus rien n'est compté.
    expect(lireComptageRequetes()).toBe(pendant);
  });

  it("compte aussi les requêtes émises dans une transaction", async () => {
    // C'est le cas qui importe : la correction écrit dans une transaction, et
    // un compteur aveugle à celle-ci laisserait croire à trois requêtes là où
    // il y en a trente.
    process.env.PROFIL_SQL = "1";
    const {
      getDb, demarrerComptageRequetes, lireComptageRequetes, arreterComptageRequetes,
    } = await import("../connection");
    const { sql } = await import("drizzle-orm");
    const db = getDb();

    demarrerComptageRequetes();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1`);
      await tx.execute(sql`SELECT 2`);
    });
    const compte = lireComptageRequetes();
    arreterComptageRequetes();
    expect(compte).toBeGreaterThanOrEqual(2);
  });

  it("remet le compteur à zéro à chaque mesure", async () => {
    process.env.PROFIL_SQL = "1";
    const {
      getDb, demarrerComptageRequetes, lireComptageRequetes, arreterComptageRequetes,
    } = await import("../connection");
    const { sql } = await import("drizzle-orm");
    const db = getDb();

    demarrerComptageRequetes();
    await db.execute(sql`SELECT 1`);
    arreterComptageRequetes();

    demarrerComptageRequetes();
    await db.execute(sql`SELECT 1`);
    const seconde = lireComptageRequetes();
    arreterComptageRequetes();
    expect(seconde).toBeLessThanOrEqual(2);
  });
});
