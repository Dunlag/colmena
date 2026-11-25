import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hostError, mockHost, mountWorker, test } from 'orca/testing'
import { abrirColmena, abrirNodo } from './navegar'
import { textos } from './textos'

async function probarEnlace(
  espacios: (raiz: string) => { id: string; path: string; kind: 'folder' | 'worktree' }[],
  propio: (raiz: string) => string, esperado: { espacio: string; ruta: string; abierto: string },
) {
  const raiz = await mkdtemp(join(process.cwd(), '.colmena-prueba-'))
  const host = mockHost({ results: {
    // El espacio activo nunca decide dónde se escribe el enlace.
    'workspace.readContext': { workspaceId: 'activo', branch: '', displayName: 'Activo', terminals: [] },
    'workspace.list': {
      workspaces: espacios(raiz).map((e) => ({ ...e, hostId: null, name: e.id, branch: null })), truncated: false,
    },
    'editor.open': { opened: true },
    'workspace.open': { opened: true },
  } })
  const worker = await mountWorker({
    default: (orca) => { orca.commands.register('colmena.abrir', () => abrirColmena(orca.host, propio(raiz))) },
  }, { host, commands: ['colmena.abrir'] })
  try {
    const { espacio, ruta, abierto } = esperado
    const enlace = join(raiz, ruta)
    assert.deepEqual(await worker.command('colmena.abrir'), {})
    assert.equal(await readFile(enlace, 'utf8'), `${textos.enlaceColmena}\n`)
    await writeFile(enlace, 'Contenido existente')
    assert.deepEqual(await worker.command('colmena.abrir'), {})
    assert.equal(await readFile(enlace, 'utf8'), 'Contenido existente')
    assert.deepEqual(host.callsOf('editor.open'), Array(2).fill({ workspaceId: espacio, path: abierto }))
    assert.deepEqual(host.callsOf('workspace.open'), Array(2).fill({ workspaceId: espacio }))
  } finally {
    await worker.deactivate()
    await rm(raiz, { recursive: true, force: true })
  }
}

test('Abre siempre el mismo enlace dentro de la carpeta del plugin y no sobrescribe', () =>
  probarEnlace(
    (raiz) => [{ id: 'activo', path: join(raiz, 'otro'), kind: 'folder' }, { id: 'plugin', path: join(raiz, 'colmena'), kind: 'folder' }],
    (raiz) => join(raiz, 'colmena', '.orca', 'Colmena.colmena'),
    { espacio: 'plugin', ruta: 'colmena/.orca/Colmena.colmena', abierto: '.orca/Colmena.colmena' },
  ))

test('Sin la carpeta del plugin abierta usa la carpeta de Bob, nunca la del espacio activo', () =>
  probarEnlace(
    (raiz) => [{ id: 'activo', path: join(raiz, 'otro'), kind: 'folder' }, { id: 'bob', path: join(raiz, 'bots', 'bob'), kind: 'folder' }],
    () => '/instalado/fuera/Colmena.colmena',
    { espacio: 'bob', ruta: 'bots/bob/.colmena/Colmena.colmena', abierto: '.colmena/Colmena.colmena' },
  ))

test('Enfoca el terminal local y abre su espacio si el terminal cerró', async () => {
  const host = mockHost({ results: {
    'terminal.focus': { focused: true },
    'workspace.open': { opened: true },
  } })
  const worker = await mountWorker({
    default: (orca) => {
      orca.commands.register('nodo', (_entrada, { signal }) => abrirNodo(orca.host, signal, {
        id: 'worker', tipo: 'worker', maquina: 'local', nombre: 'Codex',
        estado: textos.enCurso, tarea: null, desde: null,
        destino: { terminalId: 'term_a', workspaceId: 'taller' },
      }))
    },
  }, { host, commands: ['nodo'] })
  try {
    assert.deepEqual(await worker.command('nodo'), {})
    assert.deepEqual(host.callsOf('terminal.focus'), [{ terminalId: 'term_a' }])
    assert.deepEqual(host.callsOf('workspace.open'), [])
    host.respond('terminal.focus', () => { throw hostError('action_failed', 'terminal_exited') })
    assert.deepEqual(await worker.command('nodo'), {})
    assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'taller' }])
  } finally {
    await worker.deactivate()
  }
})
