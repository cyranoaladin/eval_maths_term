/**
 * La migration 0007 ne perd aucun incident de surveillance.
 *
 * Elle supprime `sessions.cheatEvents`, un tableau JSON remplacé depuis
 * longtemps par la table `cheat_events`. Une colonne « dépréciée » n'est pas
 * une colonne vide : celle-ci peut encore porter, sur une base de production,
 * des incidents qui fondent une décision de l'établissement sur une copie. La
 * migration les recopie avant de supprimer.
 *
 * Ce test l'exécute pour de vrai, sur une base montée pour lui, avec des
 * données dans la colonne. C'est la seule façon de savoir : sur la base de
 * développement la colonne est déjà partie, et une relecture du SQL ne dit rien
 * du comportement de `JSON_TABLE`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const URL_TEST = process.env.TEST_DATABASE_URL ?? "";
const DOSSIER = join(import.meta.dirname, "..", "..", "..", "db", "migrations");
const BASE = "eval_maths_migration_0007";

let connexion: mysql.Connection;

/** Les ordres d'une migration, dans l'ordre, commentaires retirés. */
function ordres(fichier: string): string[] {
  return readFileSync(join(DOSSIER, fichier), "utf8")
    .split("--> statement-breakpoint")
    .map((bloc) =>
      bloc
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((o) => o !== "");
}

function migrations(): string[] {
  return readdirSync(DOSSIER)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

beforeAll(async () => {
  const adresse = new URL(URL_TEST);
  adresse.pathname = "/";
  connexion = await mysql.createConnection({
    uri: adresse.toString(),
    multipleStatements: false,
  });
  await connexion.query(`drop database if exists \`${BASE}\``);
  await connexion.query(
    `create database \`${BASE}\` character set utf8mb4 collate utf8mb4_unicode_ci`,
  );
  await connexion.changeUser({ database: BASE });

  // Toutes les migrations SAUF celle qu'on veut éprouver.
  for (const fichier of migrations()) {
    if (fichier.startsWith("0007_")) break;
    for (const ordre of ordres(fichier)) await connexion.query(ordre);
  }
}, 120_000);

afterAll(async () => {
  if (!connexion) return;
  await connexion.query(`drop database if exists \`${BASE}\``);
  await connexion.end();
});

describe("migration 0007 — retrait de la dette anti-triche", () => {
  it("monte une base où la colonne JSON existe encore", async () => {
    const [colonnes] = await connexion.query<mysql.RowDataPacket[]>(
      "select column_name from information_schema.columns " +
        "where table_schema = ? and table_name = 'sessions' " +
        "and column_name in ('cheatEvents', 'tabSwitchCount')",
      [BASE],
    );
    expect(colonnes).toHaveLength(2);
  });

  it("recopie les incidents dans cheat_events, puis supprime les colonnes", async () => {
    await connexion.query(
      "insert into evaluations (id, title, duration) values (1, 'Éprouvée', 60)",
    );
    await connexion.query(
      "insert into sessions (id, evaluationId, studentName, cheatEvents) values " +
        "(1, 1, 'Durand Léa', ?), (2, 1, 'Sans incident', null)",
      [
        JSON.stringify([
          { type: "tab_switch", timestamp: "2026-01-15 10:03:22" },
          { type: "copy", timestamp: "2026-01-15 10:07:41" },
          { type: "fullscreen_exit", timestamp: "2026-01-15 10:12:05" },
        ]),
      ],
    );

    for (const ordre of ordres("0007_retrait_dette_anticheat.sql")) {
      await connexion.query(ordre);
    }

    const [incidents] = await connexion.query<mysql.RowDataPacket[]>(
      "select type, date_format(timestamp, '%Y-%m-%d %H:%i:%s') as instant " +
        "from cheat_events where sessionId = 1 order by timestamp",
    );
    expect(incidents.map((i) => i.type)).toEqual([
      "tab_switch",
      "copy",
      "fullscreen_exit",
    ]);
    // L'heure exacte est conservée : elle situe l'incident dans l'épreuve.
    // Lue telle que la base la stocke, sans passer par le fuseau du client.
    expect(incidents.map((i) => i.instant)).toEqual([
      "2026-01-15 10:03:22",
      "2026-01-15 10:07:41",
      "2026-01-15 10:12:05",
    ]);

    const [aucun] = await connexion.query<mysql.RowDataPacket[]>(
      "select count(*) as n from cheat_events where sessionId = 2",
    );
    expect(Number(aucun[0].n)).toBe(0);

    const [colonnes] = await connexion.query<mysql.RowDataPacket[]>(
      "select column_name from information_schema.columns " +
        "where table_schema = ? and table_name = 'sessions' " +
        "and column_name in ('cheatEvents', 'tabSwitchCount')",
      [BASE],
    );
    expect(colonnes).toHaveLength(0);
  }, 60_000);
});
