# Migrations historiques (Phases 1 à 3)

Ces trois fichiers n'ont **jamais été applicables sur une base vierge** : ils ne
contiennent que des `ALTER TABLE` portant sur des tables créées à la main via
`drizzle-kit push` pendant le développement. Aucun `CREATE TABLE` pour
`evaluations`, `questions`, `sessions` ni `responses`, et pas de journal
`meta/_journal.json` — `drizzle-kit migrate` les ignorait donc silencieusement.

Ils sont conservés comme trace des décisions de schéma (clés étrangères, index,
`gradingRubric`, colonnes anti-triche). La migration de référence générée depuis
`db/schema.ts` les remplace intégralement pour toute nouvelle installation.
