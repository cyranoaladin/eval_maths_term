/**
 * src/pages/admin/Comptes.tsx
 *
 * Autorisation des comptes, réservée aux administrateurs.
 *
 * Un compte qui se connecte pour la première fois arrive « en attente » : il
 * existe, il n'ouvre rien. Sans cet écran, personne ne pourrait l'autoriser, et
 * la fermeture de l'accès par défaut serait une impasse plutôt qu'une garde.
 */
import { useState } from "react";
import { trpc } from "@/providers/trpc-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldOff, UserCheck } from "lucide-react";

const LIBELLE_ROLE: Record<string, string> = {
  student: "Sans droits",
  teacher: "Enseignant",
  admin: "Administrateur",
};

const LIBELLE_STATUT: Record<string, string> = {
  pending: "En attente",
  active: "Autorisé",
  disabled: "Révoqué",
};

function dateCourte(valeur: Date | string | null): string {
  if (!valeur) return "—";
  return new Date(valeur).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function Comptes() {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.access.listUsers.useQuery();
  const [refus, setRefus] = useState<string | null>(null);

  const modifier = trpc.access.setAccess.useMutation({
    onSuccess: async () => {
      setRefus(null);
      await utils.access.listUsers.invalidate();
    },
    onError: (e) => setRefus(e.message),
  });

  if (isLoading) {
    return (
      <main className="flex-1 p-4">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex-1 p-4">
        <p className="text-sm text-destructive">{error.message}</p>
      </main>
    );
  }

  const comptes = data ?? [];
  const enAttente = comptes.filter((c) => c.enAttente);

  return (
    <main className="flex-1 p-4">
      <div className="space-y-4 max-w-4xl">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Comptes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Une connexion réussie ne donne aucun droit. C'est ici qu'un compte
            devient enseignant, et ici qu'on le lui retire.
          </p>
        </div>

        {refus && (
          <p role="alert" className="text-sm text-destructive">
            {refus}
          </p>
        )}

        {enAttente.length > 0 && (
          <p className="text-sm">
            <Badge variant="secondary">{enAttente.length}</Badge> compte
            {enAttente.length > 1 ? "s" : ""} en attente d'autorisation.
          </p>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {comptes.length} compte{comptes.length > 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Personne</th>
                    <th className="px-4 py-2 font-medium">Rôle</th>
                    <th className="px-4 py-2 font-medium">Accès</th>
                    <th className="px-4 py-2 font-medium">Dernière connexion</th>
                    <th className="px-4 py-2 font-medium text-right">Décider</th>
                  </tr>
                </thead>
                <tbody>
                  {comptes.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-medium">{c.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2">{LIBELLE_ROLE[c.role]}</td>
                      <td className="px-4 py-2">
                        <Badge variant={c.status === "active" ? "default" : "secondary"}>
                          {LIBELLE_STATUT[c.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {dateCourte(c.lastSignInAt)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          {!(c.role === "teacher" && c.status === "active") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={modifier.isPending}
                              onClick={() =>
                                modifier.mutate({ userId: c.id, role: "teacher", status: "active" })
                              }
                            >
                              <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                              Enseignant
                            </Button>
                          )}
                          {c.role !== "admin" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={modifier.isPending}
                              onClick={() =>
                                modifier.mutate({ userId: c.id, role: "admin", status: "active" })
                              }
                            >
                              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                              Administrateur
                            </Button>
                          )}
                          {c.status !== "disabled" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={modifier.isPending}
                              onClick={() =>
                                modifier.mutate({ userId: c.id, role: c.role, status: "disabled" })
                              }
                            >
                              <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                              Révoquer
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Révoquer n'efface rien : les classes, les tirages et les notes dont la
          personne est l'auteur restent en place.
        </p>
      </div>
    </main>
  );
}
