export type Suivi = {
  /** Nom court du projet, affiché en tête de bande. */
  projet: string
  /** Numéro de la phase en cours, à partir de 1. */
  phase: number
  /** Noms des phases, dans l'ordre. */
  phases: string[]
  /** Ce qui est en train d'être fait, en une ligne. */
  etape: string
  credits: { depenses: number; vise: number; plafond: number }
  /** Ce qui attend une décision du client, ou une phrase rassurante. */
  attente: string
  /** Vrai quand une décision du client est attendue. */
  action: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'suivi-insoumise': { suivi: Suivi | null }
  }
}
