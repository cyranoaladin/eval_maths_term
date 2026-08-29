/**
 * load/parcours-eleve.k6.js
 *
 * Deux cents élèves qui composent en même temps, comme une salle d'examen.
 *
 * Ce n'est pas un test de débit sur une route isolée : chaque utilisateur
 * virtuel joue le parcours entier — ouverture de session, lecture des énoncés,
 * brouillons, heartbeat, remise. C'est ce que fait une classe, et c'est là que
 * les coûts réels apparaissent (correction à la remise, écritures concurrentes).
 *
 * Aucune limite de production n'est contournée. Si le paramétrage du limiteur
 * est incompatible avec 200 élèves légitimes derrière une même adresse — le cas
 * ordinaire d'un établissement —, ce scénario doit le révéler, pas le masquer.
 *
 *   docker run --rm -i --network host \
 *     -e BASE_URL=http://localhost:3000 -e VUS=200 \
 *     grafana/k6 run - < load/parcours-eleve.k6.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const VUS = Number(__ENV.VUS || 200);
const EVALUATION_ID = Number(__ENV.EVALUATION_ID || 1);

const refusQuota = new Counter("refus_quota_429");
const sessionsOuvertes = new Counter("sessions_ouvertes");
const remises = new Counter("remises");
const echecMetier = new Rate("echec_metier");
const dureeOuverture = new Trend("duree_ouverture", true);
const dureeRemise = new Trend("duree_remise", true);

export const options = {
  scenarios: {
    salle_examen: {
      // Deux cents élèves qui composent **une** copie chacun. Une boucle
      // d'itérations modéliserait des milliers d'ouvertures de session : ce
      // serait un test de flood, pas une salle d'examen, et le limiteur
      // aurait raison de les refuser.
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  summaryTrendStats: ["min", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max", "avg"],
  thresholds: {
    // Le critère du projet : p95 sous 500 ms, aucune erreur.
    "http_req_duration{expected_response:true}": ["p(50)<200", "p(95)<500", "p(99)<1000"],
    // Décomposition par opération : la remise déclenche la correction complète
    // d'une copie, elle n'a pas le même coût qu'un enregistrement de brouillon.
    // Les agréger masquerait où passe réellement le temps.
    "http_req_duration{operation:session.start}": ["p(95)<500"],
    "http_req_duration{operation:question.getForActiveSession}": ["p(95)<500"],
    "http_req_duration{operation:answer.saveDraft}": ["p(95)<500"],
    "http_req_duration{operation:session.heartbeat}": ["p(95)<500"],
    "http_req_duration{operation:session.submit}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    echec_metier: ["rate<0.01"],
    refus_quota_429: ["count==0"],
  },
};

const enTetes = { "Content-Type": "application/json", Origin: BASE };

function query(chemin, entree, jeton) {
  const url = entree
    ? `${BASE}/api/trpc/${chemin}?input=${encodeURIComponent(JSON.stringify({ json: entree }))}`
    : `${BASE}/api/trpc/${chemin}`;
  const h = { ...enTetes };
  if (jeton) h["x-student-session-token"] = jeton;
  return http.get(url, { headers: h, tags: { operation: chemin } });
}

function mutation(chemin, entree, jeton) {
  const h = { ...enTetes };
  if (jeton) h["x-student-session-token"] = jeton;
  return http.post(`${BASE}/api/trpc/${chemin}`, JSON.stringify({ json: entree }), {
    headers: h,
    tags: { operation: chemin },
  });
}

function donnees(reponse) {
  try {
    return JSON.parse(reponse.body)?.result?.data?.json ?? null;
  } catch {
    return null;
  }
}

export default function () {
  // 1. Écran d'accueil : ce que voit l'élève avant de démarrer.
  const info = query("question.getPublicInfo", { evaluationId: EVALUATION_ID });
  check(info, { "les informations publiques répondent": (r) => r.status === 200 });

  // 2. Ouverture de session.
  const debutOuverture = Date.now();
  const start = mutation("session.start", {
    evaluationId: EVALUATION_ID,
    studentName: `Charge ${__VU}-${__ITER}`,
  });
  dureeOuverture.add(Date.now() - debutOuverture);

  if (start.status === 429) {
    // Refus de quota : ce n'est pas une panne, c'est une décision du serveur.
    // On la compte séparément — c'est le chiffre qui dira si le paramétrage
    // est compatible avec une salle entière derrière une seule adresse.
    refusQuota.add(1);
    echecMetier.add(false);
    sleep(3);
    return;
  }

  const session = donnees(start);
  if (!session?.sessionToken) {
    echecMetier.add(true);
    sleep(1);
    return;
  }
  sessionsOuvertes.add(1);
  const jeton = session.sessionToken;

  // 3. Lecture des énoncés.
  const qs = donnees(query("question.getForActiveSession", null, jeton));
  if (!Array.isArray(qs) || qs.length === 0) {
    echecMetier.add(true);
    return;
  }

  // 4. Composition : brouillons et signaux de présence.
  for (let i = 0; i < Math.min(6, qs.length); i++) {
    const q = qs[i];
    mutation("answer.saveDraft", {
      questionId: q.id,
      answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
    }, jeton);
    sleep(1);
  }

  mutation("session.heartbeat", {
    clientTime: Date.now(),
    focused: true,
    currentQuestionIndex: 0,
    fingerprintHash: `charge-${__VU}`,
  }, jeton);

  // 5. Remise : c'est l'appel coûteux, il déclenche la correction complète.
  const debutRemise = Date.now();
  const submit = mutation("session.submit", {
    answers: qs.map((q) => ({
      questionId: q.id,
      answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
    })),
    timeSpent: 120,
  }, jeton);
  dureeRemise.add(Date.now() - debutRemise);

  const resultat = donnees(submit);
  const remiseOk = submit.status === 200 && resultat?.success === true;
  check(submit, { "la copie est remise": () => remiseOk });
  echecMetier.add(!remiseOk);
  if (remiseOk) remises.add(1);

  sleep(1);
}
