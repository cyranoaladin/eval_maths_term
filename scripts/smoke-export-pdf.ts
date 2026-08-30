/**
 * scripts/smoke-export-pdf.ts
 *
 * Relevé de notes en PDF : contenu, encodage et protections.
 *
 * Un code 200 ne prouve rien — la signature du fichier et le texte réellement
 * extractible sont vérifiés, y compris les accents et les apostrophes, qui sont
 * le point de rupture classique d'un PDF produit par programme.
 *
 * Usage : npx tsx scripts/smoke-export-pdf.ts <cookie> <paperExamId> [url]
 */
import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const cookie = process.argv[2];
const examId = process.argv[3];
const BASE = process.argv[4] ?? "http://localhost:3000";

if (!cookie || !examId) {
  console.error("Usage : npx tsx scripts/smoke-export-pdf.ts <cookie> <paperExamId> [url]");
  process.exit(1);
}

let echecs = 0;
const ok = (l: string, v: boolean, d = "") => {
  console.log(`${v ? "  ✓" : "  ✗"} ${l}${d ? ` — ${d}` : ""}`);
  if (!v) echecs++;
};

async function main() {
  console.log(`\n▶ Relevé de notes PDF — tirage ${examId}\n`);
  const url = `${BASE}/api/paper/${examId}/resultats.pdf`;

  console.log("1. Production");
  const r = await fetch(url, { headers: { cookie: `kimi_sid=${cookie}` } });
  ok("réponse 200", r.status === 200, `HTTP ${r.status}`);
  ok("type application/pdf", r.headers.get("content-type") === "application/pdf");
  ok("non mis en cache", (r.headers.get("cache-control") ?? "").includes("no-store"));

  const pdf = Buffer.from(await r.arrayBuffer());
  ok("signature %PDF", pdf.subarray(0, 4).toString() === "%PDF",
     `${pdf.subarray(0, 8).toString().replace(/[^\x20-\x7e]/g, ".")}, ${(pdf.length / 1024).toFixed(1)} ko`);
  ok("fichier non vide", pdf.length > 1000);
  ok("terminaison %%EOF", pdf.subarray(-8).toString().includes("%%EOF"));

  console.log("\n2. Contenu lisible");
  const dossier = await mkdtemp(join(tmpdir(), "releve-"));
  const chemin = join(dossier, "resultats.pdf");
  await writeFile(chemin, pdf);
  const { stdout: texte } = await run("pdftotext", ["-layout", chemin, "-"]);

  ok("titre du document", texte.includes("Relevé de notes"));
  ok("intitulé de l'évaluation", /Évaluation|QCM/.test(texte));
  ok("moyenne de classe", /Moyenne\s*:/.test(texte));
  ok("copies saisies", /Copies saisies\s*:\s*\d+\s*\/\s*\d+/.test(texte));
  ok("colonne des notes sur 20", texte.includes("Note /20"));
  ok("mention des reprises manuelles", /Reprise/.test(texte));
  ok("date de production", /Document produit le/.test(texte));

  console.log("\n3. Français correct");
  ok("accents préservés", /é/.test(texte) && /è|ê|à/.test(texte),
     (texte.match(/[éèêàçù]/g) ?? []).slice(0, 8).join(""));
  ok("aucun caractère de remplacement", !texte.includes("�"));
  ok("virgule décimale", /\d+,\d\d/.test(texte));

  const { stdout: info } = await run("pdfinfo", [chemin]);
  ok("format A4", /595|841/.test(info), info.split("\n").find((l) => l.startsWith("Page size")) ?? "");

  console.log("\n4. Protections");
  const sansCookie = await fetch(url);
  ok("refusé sans authentification", sansCookie.status === 401, `HTTP ${sansCookie.status}`);

  const traversee = await fetch(`${BASE}/api/paper/${examId}/..%2F..%2F.env`, {
    headers: { cookie: `kimi_sid=${cookie}` },
  });
  ok("traversée de répertoire refusée", traversee.status === 404, `HTTP ${traversee.status}`);

  const inconnu = await fetch(`${BASE}/api/paper/${examId}/secrets.pdf`, {
    headers: { cookie: `kimi_sid=${cookie}` },
  });
  ok("document hors liste refusé", inconnu.status === 404, `HTTP ${inconnu.status}`);

  const tirageInexistant = await fetch(`${BASE}/api/paper/999999/resultats.pdf`, {
    headers: { cookie: `kimi_sid=${cookie}` },
  });
  ok("tirage d'autrui ou inexistant refusé", tirageInexistant.status === 404,
     `HTTP ${tirageInexistant.status}`);

  console.log(echecs === 0 ? "\n✅ Relevé PDF conforme.\n" : `\n❌ ${echecs} échec(s).\n`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});
