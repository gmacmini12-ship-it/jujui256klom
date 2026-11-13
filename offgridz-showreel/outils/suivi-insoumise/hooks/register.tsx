import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Suivi } from '../types'

// La bande lit ce fichier : il suffit de le modifier pour mettre le suivi à jour.
const FICHIER = '/home/user/jujui256klom/offgridz-showreel/suivi.json'

const suivi = atom({ plugin: 'suivi-insoumise', key: 'suivi' } as const, null)

const texte = (valeur: unknown, repli: string): string =>
  typeof valeur === 'string' && valeur.trim() !== '' ? valeur.trim() : repli

const nombre = (valeur: unknown, repli: number): number =>
  typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : repli

const champs = (valeur: unknown): Record<string, unknown> =>
  typeof valeur === 'object' && valeur !== null
    ? (valeur as Record<string, unknown>)
    : {}

/** Lit le fichier de suivi ; `null` si son contenu n'est pas exploitable. */
const lire = (source: string): Suivi | null => {
  let brut: unknown

  try {
    brut = JSON.parse(source)
  } catch {
    return null
  }

  const o = champs(brut)
  const phases = Array.isArray(o.phases)
    ? o.phases.filter((p): p is string => typeof p === 'string' && p !== '')
    : []

  if (phases.length === 0) {
    return null
  }

  const credits = champs(o.credits)
  const phase = Math.round(nombre(o.phase, 1))

  return {
    projet: texte(o.projet, 'Projet'),
    phase: Math.min(Math.max(phase, 1), phases.length),
    phases,
    etape: texte(o.etape, 'En préparation'),
    credits: {
      depenses: Math.max(nombre(credits.depenses, 0), 0),
      vise: Math.max(nombre(credits.vise, 0), 0),
      plafond: Math.max(nombre(credits.plafond, 0), 0),
    },
    attente: texte(o.attente, 'Rien à valider pour l’instant'),
    action: o.action === true,
  }
}

const entier = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',')

/** Jauge en caractères : pleine quand le budget visé est atteint. */
const jauge = (depenses: number, vise: number, cases: number): string => {
  const part = vise > 0 ? Math.min(depenses / vise, 1) : 0
  const pleines = depenses > 0 ? Math.max(Math.round(part * cases), 1) : 0

  return '█'.repeat(pleines) + '░'.repeat(cases - pleines)
}

// Dernier contenu lu : évite de réécrire l'état quand le fichier n'a pas changé.
let dernier = ''

/** Relit le fichier de suivi et met la bande à jour s'il a changé. */
async function rafraichir($: EngineInterface): Promise<void> {
  try {
    if (!(await $.fs.exists(FICHIER))) {
      return
    }

    const source = await $.fs.read(FICHIER)

    if (source === dernier) {
      return
    }

    const valeur = lire(source)

    if (valeur === null) {
      return
    }

    dernier = source
    await update($, suivi, () => valeur)
  } catch {
    // Fichier illisible à cet instant : la bande garde son dernier état.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await rafraichir($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await rafraichir($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const resultat = await next(e)
    await rafraichir($)

    return resultat
  })

  on('turn.complete', async ($, e, next) => {
    await rafraichir($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const etat = await read($, suivi)

    if (e.props.hasSurvey || etat === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const etroit = e.props.bodyColumns < 72
    const { depenses, vise, plafond } = etat.credits
    const nomPhase = etat.phases[etat.phase - 1] ?? ''
    const couleurCredits =
      depenses > plafond ? 'error' : depenses > vise ? 'warning' : 'success'

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold color="claude">
            {etat.projet}
          </Text>
          <Text bold>
            Phase {etat.phase}/{etat.phases.length} : {nomPhase}
          </Text>
        </Box>
        {etroit ? (
          <Text>
            {etat.phases
              .map((_, i) => (i + 1 < etat.phase ? '✓' : i + 1 === etat.phase ? '●' : '○'))
              .join(' ')}
          </Text>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {etat.phases.map((nom, i) =>
              i + 1 < etat.phase ? (
                <Text color="success">✓ {nom}</Text>
              ) : i + 1 === etat.phase ? (
                <Text bold color="claude">
                  ● {nom}
                </Text>
              ) : (
                <Text dimColor>○ {nom}</Text>
              ),
            )}
          </Box>
        )}
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>En cours</Text>
          <Text wrap="wrap">{etat.etape}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text dimColor>Crédits </Text>
          <Text color={couleurCredits}>{jauge(depenses, vise, etroit ? 8 : 16)}</Text>
          <Text>
            {entier(depenses)} dépensés sur {entier(vise)} visés
          </Text>
          <Text dimColor>(plafond {entier(plafond)})</Text>
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>À vous  </Text>
          {etat.action ? (
            <Text bold color="warning" wrap="wrap">
              {etat.attente}
            </Text>
          ) : (
            <Text dimColor wrap="wrap">
              {etat.attente}
            </Text>
          )}
        </Box>
      </Box>
    )
  })
}
