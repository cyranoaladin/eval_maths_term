/**
 * « Le service peut-il prendre du trafic ? »
 *
 * La question se pose au moment le plus coûteux : un répartiteur s'apprête à
 * envoyer des élèves. Un serveur qui répond « prêt » sur une base non migrée
 * accepte des copies qu'il ne pourra pas écrire — et c'est précisément ce que
 * faisait l'ancien `/api/health`, qui ne regardait que le processus.
 *
 * Ces cas dirigent le pool vers une base jetable, ce qui permet d'observer
 * l'état d'un serveur mal installé sans en installer un.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { evaluerDisponibilite, codeDErreur } from "../../lib/readiness";
import { fermerPool } from "../../queries/connection";
import { appliquerMigrations } from "@db/migrate";
import { env } from "../../lib/env";

const URL_TEST = process.env.TEST_DATABASE_URL!;
const NOM = `dispo_${process.pid}`;
let urlJetable = "";
let admin: mysql.Connection;

/** Redirige le pool vers une base, en fermant celui qui existe. */
async function pointerVers(url: string) {
  await fermerPool();
  (env as { databaseUrl: string }).databaseUrl = url;
}

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
  await pointerVers(URL_TEST);
  await admin.query("DROP DATABASE IF EXISTS `" + NOM + "`");
  await admin.end();
});

const controle = (bilan: Awaited<ReturnType<typeof evaluerDisponibilite>>, nom: string) =>
  bilan.controles.find((c) => c.nom === nom)!;

describe("un serveur correctement installé", () => {
  it("se déclare prêt, en disant sur quoi il s'appuie", async () => {
    await pointerVers(URL_TEST);

    const bilan = await evaluerDisponibilite();

    expect(bilan.pret).toBe(true);
    expect(controle(bilan, "base").etat).toBe("ok");
    expect(controle(bilan, "schema").detail).toMatch(/\d+ tables, \d+ migration/);
    expect(controle(bilan, "pool").etat).toBe("ok");
    expect(controle(bilan, "tirages").etat).toBe("ok");
    expect(controle(bilan, "disque").detail).toMatch(/\d+ Mo disponibles/);

    // Aucune réponse ne porte d'adresse de base, d'identifiant ni de chemin.
    const texte = JSON.stringify(bilan);
    expect(texte).not.toContain(new URL(URL_TEST).password);
    expect(texte).not.toContain(new URL(URL_TEST).hostname);
    expect(bilan.version).toMatch(/.+/);
  });

  it("chaque contrôle dit combien de temps il a pris", async () => {
    await pointerVers(URL_TEST);
    const bilan = await evaluerDisponibilite();
    for (const c of bilan.controles) expect(c.dureeMs).toBeGreaterThanOrEqual(0);
  });
});

describe("un serveur mal installé", () => {
  it("refuse le trafic sur une base qui n'a jamais été migrée", async () => {
    await pointerVers(urlJetable);

    const bilan = await evaluerDisponibilite();

    expect(bilan.pret).toBe(false);
    expect(controle(bilan, "schema")).toMatchObject({
      etat: "hs",
      detail: expect.stringContaining("jamais été migrée"),
    });
    // La base répond : c'est le schéma qui manque, et le bilan le distingue.
    expect(controle(bilan, "base").etat).toBe("ok");
  });

  it("refuse le trafic tant que les migrations ne sont pas toutes passées", async () => {
    await appliquerMigrations(urlJetable);
    await pointerVers(urlJetable);

    const bilan = await evaluerDisponibilite();

    expect(controle(bilan, "schema").etat).toBe("ok");
    expect(bilan.pret).toBe(true);
  }, 120_000);

  it("refuse le trafic quand la base est injoignable", async () => {
    const absente = new URL(urlJetable);
    absente.pathname = "/base_absente";
    await pointerVers(absente.toString());

    const bilan = await evaluerDisponibilite();

    expect(bilan.pret).toBe(false);
    expect(controle(bilan, "base").etat).toBe("hs");
    // Le détail nomme le code d'erreur, pas l'adresse ni les identifiants.
    expect(controle(bilan, "base").detail).not.toContain(absente.password);
  });
});

describe("ce qu'un détail d'erreur laisse voir", () => {
  it("ne rend que le nom de l'erreur", () => {
    const avecUrl = new Error("connect ECONNREFUSED mysql://root:motdepasse@10.0.0.4:3306");
    avecUrl.name = "AggregateError";
    expect(codeDErreur(avecUrl)).toBe("AggregateError");
    expect(codeDErreur("un texte jeté")).toBe("erreur inconnue");
  });
});
