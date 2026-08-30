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
 * L'adresse vient de `TEST_DATABASE_URL`, et de nulle part ailleurs : aucun
 * identifiant n'est écrit dans le code. Sans cette variable, les tests
 * s'arrêtent en disant quoi faire plutôt que de deviner une base — ou pire, de
 * tomber sur une base de travail.
 *
 * La base nommée par cette adresse est créée si elle n'existe pas : sur une
 * machine neuve, `scripts/bootstrap-dev.sh` puis `npm test` doivent suffire.
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

export const URL_TEST = process.env.TEST_DATABASE_URL ?? "";

/**
 * Crée la base si elle manque. On se connecte au serveur sans nommer de base,
 * puis on crée celle que l'adresse désigne — le nom vient de l'adresse, jamais
 * d'une chaîne écrite ici.
 */
async function creerSiAbsente(url: string): Promise<void> {
  const adresse = new URL(url);
  const nom = adresse.pathname.replace(/^\//, "");
  if (!nom) throw new Error(`TEST_DATABASE_URL ne nomme aucune base : ${url}`);

  adresse.pathname = "/";
  const connexion = await mysql.createConnection({ uri: adresse.toString() });
  try {
    await connexion.query(
      `create database if not exists \`${nom.replace(/`/g, "")}\` ` +
        "character set utf8mb4 collate utf8mb4_unicode_ci",
    );
  } finally {
    await connexion.end();
  }
}

export default async function setup() {
  if (!URL_TEST) {
    throw new Error(
      "TEST_DATABASE_URL n'est pas définie.\n" +
        "Les tests d'intégration parlent à une vraie base ; elle se monte avec :\n" +
        "  docker compose -f docker-compose.dev.yml up -d\n" +
        "puis, avec les identifiants déclarés dans ce fichier :\n" +
        "  export TEST_DATABASE_URL='mysql://<utilisateur>:<mot de passe>@127.0.0.1:3307/eval_maths_test'",
    );
  }
  await creerSiAbsente(URL_TEST);

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
