/**
 * Le migrateur embarqué dans l'image de production.
 *
 * C'est lui qui fait passer une base d'une version à la suivante, sur une
 * machine où `drizzle-kit` n'est pas installé. Un déploiement qui se croit
 * migré et ne l'est pas produit des copies sur un schéma d'hier ; un migrateur
 * qui rejoue une migration déjà passée en produit d'autres.
 *
 * Ces cas sont éprouvés sur une base jetable, créée puis supprimée ici même :
 * la base de test partagée est déjà à jour, et prouver qu'on part de zéro
 * demande de partir de zéro.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import mysql from "mysql2/promise";
import { appliquerMigrations, main, DOSSIER_PAR_DEFAUT } from "@db/migrate";

const URL_TEST = process.env.TEST_DATABASE_URL!;
const NOM = `migrateur_${process.pid}`;
let urlJetable = "";
let admin: mysql.Connection;

beforeAll(async () => {
  const base = new URL(URL_TEST);
  admin = await mysql.createConnection({
    uri: `${base.protocol}//${base.username}:${base.password}@${base.host}`,
  });
  await admin.query("DROP DATABASE IF EXISTS `" + NOM + "`");
  await admin.query("CREATE DATABASE `" + NOM + "` CHARACTER SET utf8mb4");
  base.pathname = `/${NOM}`;
  urlJetable = base.toString();
});

afterAll(async () => {
  await admin.query("DROP DATABASE IF EXISTS `" + NOM + "`");
  await admin.end();
});

async function tables(): Promise<string[]> {
  const c = await mysql.createConnection({ uri: urlJetable });
  try {
    const [rows] = await c.query<mysql.RowDataPacket[]>("SHOW TABLES");
    return rows.map((r) => Object.values(r)[0] as string).sort();
  } finally {
    await c.end();
  }
}

describe("application des migrations", () => {
  it("monte le schéma complet depuis une base vide", async () => {
    expect(await tables()).toEqual([]);

    const { dureeMs, dossier } = await appliquerMigrations(urlJetable);

    expect(dossier).toBe(DOSSIER_PAR_DEFAUT);
    expect(dureeMs).toBeGreaterThanOrEqual(0);

    const presentes = await tables();
    // Les treize tables du produit, plus le journal du migrateur.
    for (const attendue of [
      "answer_drafts", "cheat_events", "classes", "evaluations", "grade_audit",
      "paper_copies", "paper_exams", "questions", "responses", "sessions",
      "students", "users",
    ]) {
      expect(presentes).toContain(attendue);
    }
  });

  it("ne rejoue pas ce qui est déjà appliqué", async () => {
    const avant = await tables();

    await appliquerMigrations(urlJetable);

    // Rejouer doit être sans effet : c'est ce qui rend un redéploiement sûr,
    // et ce qui permet à plusieurs instances de démarrer sans se concerter.
    expect(await tables()).toEqual(avant);
  });

  it("refuse une base injoignable au lieu de faire croire à un succès", async () => {
    const injoignable = new URL(urlJetable);
    injoignable.pathname = "/base_qui_n_existe_pas";

    await expect(appliquerMigrations(injoignable.toString())).rejects.toThrow();
  });

  it("refuse un dossier de migrations absent", async () => {
    await expect(
      appliquerMigrations(urlJetable, "./db/migrations-absentes"),
    ).rejects.toThrow();
  });
});

describe("la commande de déploiement", () => {
  const ENV_INITIAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV_INITIAL };
    vi.restoreAllMocks();
  });

  it("applique les migrations et rend zéro", async () => {
    const sortie = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.DATABASE_URL = urlJetable;

    await expect(main()).resolves.toBe(0);

    // La durée est dite : c'est ce qu'on relit dans le journal d'un
    // déploiement pour savoir si la migration a été instantanée ou longue.
    expect(sortie.mock.calls[0][0]).toMatch(/Migrations appliquées en \d+ ms/);
  });

  it("refuse de deviner la base et rend un code d'échec", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.DATABASE_URL;

    await expect(main()).resolves.toBe(1);

    expect(erreur.mock.calls[0][0]).toMatch(/DATABASE_URL est requise/);
  });

  it("rend un code d'échec quand la migration ne passe pas", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DATABASE_URL = urlJetable;
    process.env.MIGRATIONS_DIR = "./db/migrations-absentes";

    // Un déploiement doit s'arrêter là : la version applicative qui suit
    // écrirait dans un schéma qui ne l'attend pas.
    await expect(main()).resolves.toBe(1);
    expect(erreur.mock.calls[0][0]).toMatch(/Migration en échec/);
  });
});
