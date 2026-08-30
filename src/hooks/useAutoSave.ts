/**
 * src/hooks/useAutoSave.ts
 *
 * Sauvegarde automatique des brouillons :
 * 1. Debounce 2 s après chaque changement → appel saveDraft.
 * 2. En cas d'échec réseau → enqueue dans IDB.
 * 3. Retry depuis IDB toutes les 5 s.
 *
 * Statuts : "idle" | "saving" | "saved" | "error" | "offline"
 *
 * `answer.saveDraft` est une route `studentQuery` : elle passe par
 * `studentTrpc`, seul client à porter le header `x-student-session-token`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { studentTrpc } from "@/providers/student-trpc";
import { enqueue, dequeueAll, size } from "@/lib/idb-queue";

const DEBOUNCE_MS = 2_000;
const RETRY_INTERVAL_MS = 5_000;
/**
 * Un réseau coupé net fait échouer la requête tout de suite ; un réseau mort
 * mais toujours associé — portail captif, borne saturée, cas ordinaire en
 * établissement — la laisse pendre indéfiniment. Sans échéance, l'indicateur
 * restait sur « Sauvegarde… » pour toujours, rien n'était mis en file locale,
 * et la copie était perdue au rechargement. Passé ce délai on considère la
 * requête perdue et on bascule sur IndexedDB.
 */
const DELAI_ENVOI_MS = 8_000;

/**
 * La requête abandonnée continue sa vie côté navigateur ; si elle finit par
 * aboutir, la relance réécrira la même réponse. `answer.saveDraft` est un
 * upsert par (session, question) : rejouer est sans effet de bord.
 */
async function avecEcheance<T>(promesse: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const echeance = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(
      () => rejeter(new Error("Délai de sauvegarde dépassé")),
      ms,
    );
  });
  try {
    return await Promise.race([promesse, echeance]);
  } finally {
    clearTimeout(minuteur);
  }
}

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

export interface DraftPayload {
  questionId: number;
  answer: string;
  justification?: string;
}

export interface UseAutoSaveOptions {
  enabled: boolean;
  sessionId?: number;
}

export interface UseAutoSaveResult {
  status: AutoSaveStatus;
  saveDraft: (payload: DraftPayload) => void;
  pendingCount: number;
}

/**
 * Ne conserve que la dernière version de chaque question.
 *
 * Hors ligne, une même question part en file à chaque pause de frappe. Les
 * rejouer toutes réécrirait successivement des états intermédiaires : si l'ordre
 * de restitution n'est pas strictement respecté, la copie peut se retrouver
 * avec une réponse antérieure à celle que l'élève voit à l'écran. Seule la
 * dernière compte.
 */
function derniersParQuestion(file: DraftPayload[]): DraftPayload[] {
  const dernier = new Map<number, DraftPayload>();
  for (const p of file) dernier.set(p.questionId, p);
  return [...dernier.values()];
}

export function useAutoSave({ enabled }: UseAutoSaveOptions): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);

  const saveDraftMutation = studentTrpc.answer.saveDraft.useMutation();

  // La mutation tRPC change d'identité à chaque rendu : on la garde dans une
  // ref pour que `doSave` reste stable sans mentir sur ses dépendances.
  const saveRef = useRef(saveDraftMutation.mutateAsync);
  useEffect(() => {
    saveRef.current = saveDraftMutation.mutateAsync;
  });

  const doSave = useCallback(
    async (payload: DraftPayload) => {
      if (!enabled || cancelRef.current) return;
      setStatus("saving");
      try {
        await avecEcheance(saveRef.current(payload), DELAI_ENVOI_MS);
        if (!cancelRef.current) setStatus("saved");
      } catch {
        if (cancelRef.current) return;
        setStatus("offline");
        await enqueue(payload);
        if (!cancelRef.current) setPendingCount(await size());
      }
    },
    [enabled],
  );

  const saveDraft = useCallback(
    (payload: DraftPayload) => {
      if (!enabled) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        doSave(payload);
      }, DEBOUNCE_MS);
    },
    [enabled, doSave],
  );

  // Retry depuis IDB
  useEffect(() => {
    cancelRef.current = false;
    if (!enabled) return;

    // Une file laissée par une passation interrompue doit être visible dès
    // l'ouverture, pas seulement après la première relance.
    void size().then((n) => {
      if (!cancelRef.current) setPendingCount(n);
    });

    // Une relance encore en cours ne doit pas en déclencher une deuxième :
    // hors ligne, les tentatives s'empileraient toutes les 5 s.
    let relanceEnCours = false;
    retryRef.current = setInterval(async () => {
      if (relanceEnCours) return;
      relanceEnCours = true;
      try {
        const queue = await dequeueAll<DraftPayload>();
        for (const payload of derniersParQuestion(queue)) {
          try {
            await avecEcheance(saveRef.current(payload), DELAI_ENVOI_MS);
            if (!cancelRef.current) setStatus("saved");
          } catch {
            await enqueue(payload);
            if (!cancelRef.current) setStatus("offline");
          }
        }
        if (!cancelRef.current) setPendingCount(await size());
      } finally {
        relanceEnCours = false;
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      cancelRef.current = true;
      if (retryRef.current) clearInterval(retryRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled]);

  return { status, saveDraft, pendingCount };
}
