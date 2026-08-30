/**
 * vitest.global-setup.ts
 *
 * Prépare la base des tests d'intégration.
 *
 * Les routeurs contiennent la moitié de la logique métier — propriété des
 * données, transactions, invariants de correction — et rien de tout cela ne
 * s'éprouve avec une base simulée : c'est justement le comportement de la base
 * qu'on veut vérifier. On monte donc un vrai schéma, à part de la base de
 * développement, et on l'applique par les migrations du dépôt : si une
 * migration est cassée, les tests d'intégration le disent avant la production.
 *
 * L'adresse vient de `TEST_DATABASE_URL`. Sans elle, les tests d'intégration
 * se déclarent inexécutables plutôt que de toucher à une base de travail.
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

export const URL_TEST =
  process.env.TEST_DATABASE_URL ??
  "mysql://eval:dev_password@127.0.0.1:3307/eval_maths_test";

export default async function setup() {
  const connexion = await mysql.createConnection({
    uri: URL_TEST,
    multipleStatements: true,
  });
  try {
    await migrate(drizzle(connexion), { migrationsFolder: "./db/migrations" });
  } finally {
    await connexion.end();
  }
}
