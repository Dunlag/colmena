import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hostError, mockHost, mountWorker, test } from 'orca/testing'
import { abrirColmena, abrirNodo } from './navegar'
import { textos } from './textos'

test('Crea un enlace en el espacio local activo y lo reutiliza sin sobrescribirlo', async () => {
  const path = await mkdtemp(join(process.cwd(), '.colmena-prueba-'))
  const host = mockHost({ results: {
    'workspace.readContext': { workspaceId: 'taller', branch: '', displayName: 'Taller', terminals: [] },
    'workspace.list': { workspaces: [{ id: 'taller', hostId: null, path, name: 'Taller', kind: 'folder', branch: null }], truncated: false },
    'editor.open': { opened: true },
    'workspace.open': { opened: true },
  } })
  const worker = await mountWorker({
    default: (orca) => { orca.commands.register('colmena.abrir', () => abrirColmena(orca.host)) },
  }, { host, commands: ['colmena.abrir'] })
  try {
    const enlace = join(path, 'Colmena.colmena')
    assert.deepEqual(await worker.command('colmena.abrir'), {})
    assert.equal(await readFile(enlace, 'utf8'), `${textos.enlaceColmena}\n`)
    await writeFile(enlace, 'Contenido existente')
    assert.deepEqual(await worker.command('colmena.abrir'), {})
    assert.equal(await readFile(enlace, 'utf8'), 'Contenido existente')
    assert.deepEqual(host.callsOf('editor.open'), Array(2).fill({ workspaceId: 'taller', path: 'Colmena.colmena' }))
    assert.deepEqual(host.callsOf('workspace.open'), Array(2).fill({ workspaceId: 'taller' }))
  } finally {
    await worker.deactivate()
    await rm(path, { recursive: true, force: true })
  }
})

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
