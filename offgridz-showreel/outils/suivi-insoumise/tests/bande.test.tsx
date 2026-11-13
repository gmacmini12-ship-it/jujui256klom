import { expect, test } from 'claude-code/testing'

const BANDE = {
  plugin: 'suivi-insoumise',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 96,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const FICHIER = JSON.stringify({
  projet: 'OFFGRIDZ · INSOUMISE',
  phase: 3,
  phases: ['Questions', 'Concept', 'Préproduction', 'Production', 'Contrôle qualité'],
  etape: 'Test GPU sur machine louée',
  credits: { depenses: 12.5, vise: 200, plafond: 345 },
  attente: 'Valider le palier 2 (40 crédits)',
  action: true,
})

test('la bande montre phase, étape, crédits et décision attendue, sur chaque surface', async ($, on) => {
  // Rien ne se trouve sous le mod : ces hooks tiennent lieu de moteur.
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: FICHIER }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BANDE, surface })

    expect((await ui.find({ type: 'Text', text: /Phase 3\/5/ }))?.text).toBe('Phase 3/5 : Préproduction')
    expect((await ui.find({ type: 'Text', text: /Préproduction$/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Test GPU/ }))?.text).toBe('Test GPU sur machine louée')
    expect((await ui.find({ type: 'Text', text: /dépensés/ }))?.text).toBe('12,5 dépensés sur 200 visés')
    expect((await ui.find({ type: 'Text', text: /plafond/ }))?.text).toBe('(plafond 345)')
    expect((await ui.find({ type: 'Text', text: /palier 2/ }))?.text).toBe('Valider le palier 2 (40 crédits)')
    await ui.unmount()
  }
})

test('sur un écran étroit, les phases tiennent en une ligne de pastilles', async ($, on) => {
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: FICHIER }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })

  const ui = await $.ui.mount({
    ...BANDE,
    props: { ...BANDE.props, bodyColumns: 40 },
    surface: 'mobile',
  })

  expect((await ui.find({ type: 'Text', text: /●/ }))?.text).toBe('✓ ✓ ● ○ ○')
  await ui.unmount()
})

test('sans fichier de suivi lisible, la bande laisse la place au moteur', async ($, on) => {
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: 'pas du JSON' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>moteur</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BANDE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /moteur/ }))?.text).toBe('moteur')
  await ui.unmount()
})
