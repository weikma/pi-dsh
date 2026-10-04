/** Directory and application controls stay usable through asynchronous Host results. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DirectoryPicker } from '../client/DirectoryPicker.tsx'
import { OpenPathActions } from '../client/OpenPathActions.tsx'
import { api } from '../client/http.ts'
import { translate } from '../client/i18n.ts'
import type { DirectoryListing } from '../local-files-types.ts'

const t = (key: Parameters<typeof translate>[1]) => translate('en', key)
const listing = (path = '/home'): DirectoryListing => ({ path, home: '/home', parent: '/', truncated: false, entries: [
  { name: 'project', path: path + '/project', hidden: false }, { name: '.config', path: path + '/.config', hidden: true },
] })
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(yes => { resolve = yes }), resolve: (value: T) => resolve(value) } }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(api, 'directories').mockImplementation(async path => listing(path))
  vi.spyOn(api, 'createDirectory').mockImplementation(async (path, name) => ({ path: path + '/' + name }))
  vi.spyOn(api, 'localApplications').mockResolvedValue({ available: true, applications: [
    { id: 'textedit', name: 'TextEdit', kind: 'editor' }, { id: 'terminal', name: 'Terminal', kind: 'terminal' },
  ], canChooseEditor: false })
  vi.spyOn(api, 'openPath').mockResolvedValue({ status: 'opened' })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('browses folders, filters dot names and creates a child before selecting the project', async () => {
  const user = userEvent.setup(), select = vi.fn(async () => {})
  render(<DirectoryPicker initialPath="/home" error="" t={t} close={() => {}} select={select} />)
  expect(await screen.findByRole('button', { name: 'project' })).toBeDefined()
  expect(screen.queryByRole('button', { name: '.config' })).toBeNull()
  await user.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: '.config' })).toBeDefined()
  await user.type(screen.getByRole('searchbox'), 'project')
  expect(screen.queryByRole('button', { name: '.config' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'project' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Project directory' })).toHaveProperty('value', '/home/project'))
  await user.click(screen.getByRole('button', { name: 'New folder' }))
  await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'New project')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(api.createDirectory).toHaveBeenCalledWith('/home/project', 'New project'))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Project directory' })).toHaveProperty('value', '/home/project/New project'))
  await user.click(screen.getByRole('button', { name: 'Open project' }))
  expect(select).toHaveBeenCalledWith('/home/project/New project')
})

it('preserves typed paths through initial discovery and ignores an older navigation response', async () => {
  const initial = deferred<DirectoryListing>(), older = deferred<DirectoryListing>(), current = deferred<DirectoryListing>()
  vi.mocked(api.directories).mockReturnValueOnce(initial.promise).mockReturnValueOnce(older.promise).mockReturnValueOnce(current.promise)
  const user = userEvent.setup()
  render(<DirectoryPicker initialPath="" error="" t={t} close={() => {}} select={async () => {}} />)
  const input = screen.getByRole('textbox', { name: 'Project directory' })
  await user.type(input, '/typed')
  await act(async () => { initial.resolve(listing()) })
  expect(input).toHaveProperty('value', '/typed')
  await user.click(screen.getByRole('button', { name: 'Browse' }))
  await user.clear(input); await user.type(input, '/newer')
  await user.click(screen.getByRole('button', { name: 'Browse' }))
  await act(async () => { current.resolve(listing('/newer')) })
  await act(async () => { older.resolve(listing('/typed')) })
  expect(input).toHaveProperty('value', '/newer')
  expect(api.directories).toHaveBeenLastCalledWith('/newer', expect.any(AbortSignal))
})

it('allows an explicit path after browsing fails and keeps failed creation open for correction', async () => {
  vi.mocked(api.directories).mockRejectedValueOnce(new Error('Unavailable'))
  const select = vi.fn(async () => {}), user = userEvent.setup()
  render(<DirectoryPicker initialPath="/manual" error="" t={t} close={() => {}} select={select} />)
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: 'Open project' }))
  expect(select).toHaveBeenCalledWith('/manual')
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('button', { name: 'project' })
  vi.mocked(api.createDirectory).mockRejectedValueOnce(new Error('Exists'))
  await user.click(screen.getByRole('button', { name: 'New folder' }))
  await user.type(screen.getByRole('textbox', { name: 'Folder name' }), 'Exists')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox', { name: 'Folder name' })).toHaveProperty('value', 'Exists')
})

it('opens a project terminal and dismisses its menu with Escape', async () => {
  const user = userEvent.setup(), feedback = vi.fn()
  render(<OpenPathActions cwd="/home" path="/home" directory t={t} feedback={feedback} />)
  await waitFor(() => expect(api.localApplications).toHaveBeenCalled())
  await user.click(screen.getByRole('button', { name: 'Open in…' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Terminal' }))
  await waitFor(() => expect(api.openPath).toHaveBeenCalledWith({ cwd: '/home', path: '/home', action: 'application', applicationId: 'terminal' }))
  await waitFor(() => expect(feedback).toHaveBeenCalledWith(t('fileOpenRequested')))
  await user.click(screen.getByRole('button', { name: 'Open in…' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
})

it('keeps download and copy available without a local desktop', async () => {
  vi.mocked(api.localApplications).mockResolvedValue({ available: false, applications: [], canChooseEditor: false })
  const user = userEvent.setup(), feedback = vi.fn()
  const { container } = render(<OpenPathActions cwd="/home" path="/home/report.txt" t={t} feedback={feedback} />)
  await user.click(screen.getByRole('button', { name: 'File actions' }))
  expect(screen.queryByRole('menuitem', { name: 'Open with default app' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Open in editor' })).toBeNull()
  expect(screen.getByRole('menuitem', { name: 'Download file' })).toBeDefined()
  const download = container.querySelector('a')!
  expect(download.getAttribute('href')).toBe('/api/file-download?cwd=%2Fhome&path=%2Fhome%2Freport.txt')
  const clicked = vi.spyOn(download, 'click').mockImplementation(() => {})
  await user.click(screen.getByRole('menuitem', { name: 'Download file' }))
  expect(clicked).toHaveBeenCalledOnce()
})

it('reports launcher failure and permits retry through the same file controls', async () => {
  vi.mocked(api.openPath).mockRejectedValueOnce(new Error('Application removed'))
  const user = userEvent.setup(), feedback = vi.fn()
  render(<OpenPathActions cwd="/home" path="/home/report.txt" t={t} feedback={feedback} />)
  await user.click(await screen.findByRole('button', { name: 'Open in editor' }))
  await user.click(screen.getByRole('menuitem', { name: 'TextEdit' }))
  await waitFor(() => expect(feedback).toHaveBeenCalledWith(t('openApplicationFailed')))
  await user.click(screen.getByRole('button', { name: 'Open in editor' }))
  await user.click(screen.getByRole('menuitem', { name: 'TextEdit' }))
  await waitFor(() => expect(feedback).toHaveBeenCalledWith(t('fileOpenRequested')))
})
