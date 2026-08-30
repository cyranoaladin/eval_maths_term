/**
 * scripts/smoke-export-csv.ts
 *
 * Le relevé au format tableur, tel qu'un enseignant le télécharge réellement.
 *
 * Les tests unitaires vérifient le contenu du fichier ; ce script vérifie ce
 * que le serveur en fait : type de contenu, nom de fichier proposé, encodage
 * sur le fil, et surtout qui a le droit de le récupérer. Un relevé de notes
 * accessible à un autre enseignant serait une fuite, pas un désagrément.
 *
 *   npx tsx scripts/dev-session.ts   # pour le cookie
 *   npx tsx scripts/smoke-export-csv.ts <cookie>
 */
import "dotenv/config";
import { desc, eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { getDb } from "../api/queries/connection";
import { classes, paperExams } from "../db/schema";

const cookie = process.argv[2];
const BASE = process.argv[3] ?? "http://localhost:3000";
if (!cookie) {
  console.error("Cookie requis : npx tsx scripts/dev-session.ts");
  process.exit(1);
}

let echecs = 0;
const ok = (label: string, vrai: boolean, detail = "") => {
  console.log(`  ${vrai ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!vrai) echecs++;
};

function cookieDe(nom: string, email: string, unionId: string): string {
  const sortie = execFileSync("npx", ["tsx", "scripts/dev-session.ts", nom, email, unionId], {
    encoding: "utf8",
  });
  return sortie.match(/kimi_sid=([^;"]+)/)![1];
}

async function main() {
  console.log(`\n▶ Export CSV du relevé — ${BASE}\n`);
  const db = getDb();

  console.log("1. Un tirage appartenant à l'enseignant");
  // Le tirage est cherché en base : `listExams` exige une évaluation, et ce
  // n'est pas elle qu'on veut éprouver ici.
  const [tirage] = await db
    .select({ id: paperExams.id, label: paperExams.label })
    .from(paperExams)
    .orderBy(desc(paperExams.id))
    .limit(1);
  ok("un tirage est disponible", !!tirage, tirage ? `#${tirage.id} — ${tirage.label ?? "sans nom"}` : "aucun");
  if (!tirage) process.exit(1);

  console.log("\n2. Téléchargement réel");
  const url = `${BASE}/api/paper/${tirage.id}/resultats.csv`;
  const rep = await fetch(url, { headers: { cookie: `kimi_sid=${cookie}` } });
  ok("le serveur répond 200", rep.status === 200, `HTTP ${rep.status}`);

  const type = rep.headers.get("content-type") ?? "";
  ok("le type de contenu annonce un CSV en UTF-8",
    type.includes("text/csv") && type.includes("utf-8"), type);

  const disposition = rep.headers.get("content-disposition") ?? "";
  ok("le fichier est proposé en téléchargement", disposition.startsWith("attachment"), disposition);
  ok("le nom de fichier est explicite",
    /filename="notes-.*\.csv"/.test(disposition), disposition);
  ok("le relevé n'est pas mis en cache",
    (rep.headers.get("cache-control") ?? "").includes("no-store"),
    rep.headers.get("cache-control") ?? "absent");

  const octets = Buffer.from(await rep.arrayBuffer());
  const texte = octets.toString("utf8");

  console.log("\n3. Encodage");
  ok("le fichier commence par la marque d'ordre des octets UTF-8",
    octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf,
    `${octets[0]?.toString(16)} ${octets[1]?.toString(16)} ${octets[2]?.toString(16)}`);
  ok("aucun caractère de remplacement", !texte.includes("�"));
  ok("les lignes se terminent en CRLF", texte.includes("\r\n"));

  console.log("\n4. Contenu");
  const lignes = texte.split("\r\n");
  const iEnTete = lignes.findIndex((l) => l.startsWith("N° copie"));
  ok("l'en-tête du tableau est présent", iEnTete >= 0, lignes[iEnTete] ?? "absent");
  ok("les colonnes sont séparées par des points-virgules",
    (lignes[iEnTete]?.split(";").length ?? 0) === 7, `${lignes[iEnTete]?.split(";").length} colonnes`);

  const donnees = lignes.slice(iEnTete + 1).filter(Boolean);
  ok("au moins une copie est listée", donnees.length > 0, `${donnees.length} ligne(s)`);

  const accents = texte.match(/[éèêëàâçîïôûùü]/g) ?? [];
  ok("les accents traversent le fil intacts", accents.length > 0, `${accents.length} caractères accentués`);

  const notes = donnees.map((l) => l.split(";")[4]).filter(Boolean);
  ok("les notes emploient la virgule décimale",
    notes.every((n) => n === "" || /^\d+,\d{2}$/.test(n)), notes.slice(0, 4).join(" "));
  ok("la moyenne est présente et décimale",
    /Moyenne \/20;(\d+,\d{2})?/.test(texte),
    texte.split("\r\n").find((l) => l.startsWith("Moyenne")) ?? "absente");

  console.log("\n5. Périmètre des données");
  const [cls] = await db
    .select({ nom: classes.name })
    .from(paperExams)
    .innerJoin(classes, eq(classes.id, paperExams.classId))
    .where(eq(paperExams.id, tirage.id))
    .limit(1);
  ok("le relevé nomme la classe du tirage", texte.includes(cls.nom), cls.nom);

  const autresClasses = await db.select().from(classes);
  const intruses = autresClasses
    .filter((c) => c.name !== cls.nom)
    .filter((c) => texte.includes(c.name));
  ok("aucune autre classe n'apparaît", intruses.length === 0,
    intruses.map((c) => c.name).join(", ") || "aucune");

  console.log("\n6. Qui peut le télécharger");
  const anonyme = await fetch(url);
  ok("un anonyme est refusé", anonyme.status === 401 || anonyme.status === 403, `HTTP ${anonyme.status}`);

  const cookieAutre = cookieDe("Autre enseignant", "autre@localhost", "dev-teacher-2");
  const autre = await fetch(url, { headers: { cookie: `kimi_sid=${cookieAutre}` } });
  ok("un autre enseignant est refusé", autre.status === 404 || autre.status === 403,
    `HTTP ${autre.status}`);

  const inexistant = await fetch(`${BASE}/api/paper/999999/resultats.csv`, {
    headers: { cookie: `kimi_sid=${cookie}` },
  });
  ok("un tirage inexistant est refusé", inexistant.status === 404, `HTTP ${inexistant.status}`);

  console.log(
    echecs === 0
      ? "\n✅ Export CSV vérifié : encodage, en-têtes, contenu et périmètre."
      : `\n❌ ${echecs} vérification(s) en échec.`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});
