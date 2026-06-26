import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Workspace } from '@/types'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (value: string) => void
    value: string
  }) => (
    <textarea
      aria-label="Resume YAML editor"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    />
  ),
}))

const baseWorkspace: Workspace = {
  workspace_path: '/tmp/resume-workspace',
  initialized: true,
  variants: [
    {
      name: 'base',
      has_pdf: false,
      state: { hash: 'hash-base', mtime_ns: 1 },
    },
    {
      name: 'openai',
      has_pdf: true,
      state: { hash: 'hash-openai', mtime_ns: 2 },
    },
  ],
  selected: 'base',
  content: 'cv:\n  name: Your Name\n',
  state: { hash: 'hash-base', mtime_ns: 1 },
  updated_at: '2026-06-26 10:00:00',
  history: [
    {
      commit: 'abc123',
      short_commit: 'abc123',
      date: '2026-06-26',
      message: 'Initial resume',
    },
  ],
  pdf_url: null,
  preview_url: null,
}

function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  )
}

function setDesktopMode(matches: boolean) {
  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  vi.stubGlobal('matchMedia', matchMedia)
  window.matchMedia = matchMedia
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setDesktopMode(true)
})

describe('Resume Studio app', () => {
  it('initializes an empty workspace', async () => {
    const initialized = { ...baseWorkspace }
    const fetchMock = mockFetch((input, init) => {
      if (String(input) === '/api/workspace') {
        return jsonResponse({ ...baseWorkspace, initialized: false, variants: [] })
      }
      if (String(input) === '/api/init' && init?.method === 'POST') {
        return jsonResponse(initialized)
      }
      return jsonResponse({})
    })

    renderApp()

    expect(await screen.findByText('Begin with a base resume')).toBeInTheDocument()
    const workspaceInput = screen.getByLabelText(/workspace directory/i)
    expect(workspaceInput).toHaveValue('/tmp/resume-workspace')
    await userEvent.clear(workspaceInput)
    await userEvent.type(workspaceInput, '/tmp/custom-resume-workspace')
    await userEvent.click(screen.getByRole('button', { name: /initialize workspace/i }))

    await waitFor(() => expect(screen.getByText('Workspace initialized.')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/init',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      workspace_path: '/tmp/custom-resume-workspace',
    })
  })

  it('selects a variant through the authoritative workspace endpoint', async () => {
    const openaiWorkspace = {
      ...baseWorkspace,
      selected: 'openai',
      content: 'cv:\n  name: OpenAI Resume\n',
      state: { hash: 'hash-openai', mtime_ns: 2 },
      pdf_url: '/variants/openai/pdf',
      preview_url: '/variants/openai/preview.png?v=2',
    }
    const fetchMock = mockFetch((input) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/workspace?variant=openai') {
        return jsonResponse(openaiWorkspace)
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: /openai/i }))

    await waitFor(() => {
      expect(screen.getAllByText('variants/openai/resume.yaml').length).toBeGreaterThan(0)
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace?variant=openai',
      expect.any(Object),
    )
    expect(screen.getByAltText('Rendered resume preview')).toHaveAttribute(
      'src',
      '/variants/openai/preview.png?v=2',
    )
  })

  it('keeps the clean state quiet instead of showing a saved badge', async () => {
    mockFetch((input) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await screen.findByText('Resume Studio')
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.queryByText('Clean draft')).not.toBeInTheDocument()
  })

  it('tracks dirty editor state and saves changes', async () => {
    const savedWorkspace = {
      ...baseWorkspace,
      content: 'cv:\n  name: Edited\n',
      state: { hash: 'hash-saved', mtime_ns: 3 },
    }
    const fetchMock = mockFetch((input, init) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants/base/resume' && init?.method === 'PUT') {
        return jsonResponse(savedWorkspace)
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    const editor = await screen.findByLabelText('Resume YAML editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'cv:\n  name: Edited\n')

    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(screen.getByText('Saved changes.')).toBeInTheDocument())
    const saveBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
    expect(saveBody).toMatchObject({
      content: 'cv:\n  name: Edited\n',
      expected_hash: 'hash-base',
      force: false,
    })
  })

  it('shows stale-file warning and overwrite only when browser edits exist', async () => {
    mockFetch((input) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants/base/resume') {
        return jsonResponse(
          { detail: 'This file changed on disk. Reload or overwrite.' },
          409,
        )
      }
      return jsonResponse({})
    })

    renderApp()
    await screen.findAllByText('variants/base/resume.yaml')
    const editor = await screen.findByLabelText('Resume YAML editor')
    await userEvent.type(editor, 'edited')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('This file changed on disk')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /overwrite disk file/i })).toBeInTheDocument()
  })

  it('renders preview in a dismissible popup on desktop', async () => {
    const renderedWorkspace = {
      ...baseWorkspace,
      pdf_url: '/variants/base/pdf',
      preview_url: '/variants/base/preview.png?v=3',
    }
    mockFetch((input, init) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants/base/render' && init?.method === 'POST') {
        return jsonResponse({ workspace: renderedWorkspace, output: 'rendered ok' })
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: /render preview/i }))

    expect(await screen.findByRole('dialog', { name: /preview rendered\./i })).toBeInTheDocument()
    expect(screen.getByText('rendered ok')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /export pdf/i })).toHaveAttribute(
      'href',
      '/variants/base/pdf',
    )
    expect(screen.getByAltText('Rendered resume preview')).toHaveAttribute(
      'src',
      '/variants/base/preview.png?v=3',
    )

    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByText('rendered ok')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /preview rendered\./i })).not.toBeInTheDocument()
  })

  it('shows render failure status with diagnostic logs in the popup', async () => {
    mockFetch((input, init) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants/base/render' && init?.method === 'POST') {
        return jsonResponse(
          {
            detail: 'RenderCV could not render this variant.',
            render_output: 'line 12: missing required field',
          },
          400,
        )
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: /render preview/i }))

    expect(await screen.findByRole('dialog', { name: /render failed/i })).toBeInTheDocument()
    expect(screen.getAllByText('RenderCV could not render this variant.').length).toBeGreaterThan(0)
    expect(screen.getByText('line 12: missing required field')).toBeInTheDocument()
  })

  it('saves unsaved editor changes before rendering', async () => {
    const savedWorkspace = {
      ...baseWorkspace,
      content: 'cv:\n  name: Edited Before Render\n',
      state: { hash: 'hash-saved', mtime_ns: 3 },
    }
    const renderedWorkspace = {
      ...savedWorkspace,
      pdf_url: '/variants/base/pdf',
      preview_url: '/variants/base/preview.png?v=4',
    }
    const fetchMock = mockFetch((input, init) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants/base/resume' && init?.method === 'PUT') {
        return jsonResponse(savedWorkspace)
      }
      if (String(input) === '/api/variants/base/render' && init?.method === 'POST') {
        return jsonResponse({ workspace: renderedWorkspace, output: 'rendered after save' })
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    const editor = await screen.findByLabelText('Resume YAML editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'cv:\n  name: Edited Before Render\n')
    await userEvent.click(screen.getByRole('button', { name: /render preview/i }))

    await screen.findByRole('dialog', { name: /preview rendered\./i })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/variants/base/resume',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/variants/base/render',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows the image preview on mobile without mounting a PDF embed', async () => {
    setDesktopMode(false)
    const openaiWorkspace = {
      ...baseWorkspace,
      selected: 'openai',
      content: 'cv:\n  name: OpenAI Resume\n',
      state: { hash: 'hash-openai', mtime_ns: 2 },
      pdf_url: '/variants/openai/pdf',
      preview_url: '/variants/openai/preview.png?v=2',
    }
    mockFetch((input) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/workspace?variant=openai') {
        return jsonResponse(openaiWorkspace)
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: /openai/i }))

    const pdfLinks = await screen.findAllByRole('link', { name: /export pdf/i })
    expect(pdfLinks[0]).toHaveAttribute('href', '/variants/openai/pdf')
    expect(await screen.findByAltText('Rendered resume preview')).toHaveAttribute(
      'src',
      '/variants/openai/preview.png?v=2',
    )
    expect(screen.queryByLabelText('Rendered resume PDF')).not.toBeInTheDocument()
  })

  it('keeps the variants panel non-collapsible on desktop', async () => {
    mockFetch((input) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await screen.findAllByText('variants/base/resume.yaml')
    expect(screen.getByRole('separator', { name: /resize variants panel/i })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: /resize preview panel/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /minimize variants panel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand variants panel/i })).not.toBeInTheDocument()
  })

  it('submits a snapshot message', async () => {
    const fetchMock = mockFetch((input, init) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants/base/snapshot' && init?.method === 'POST') {
        return jsonResponse({
          ...baseWorkspace,
          history: [
            {
              commit: 'def456',
              short_commit: 'def456',
              date: '2026-06-26',
              message: 'Tailor backend summary',
            },
            ...baseWorkspace.history,
          ],
        })
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: /create snapshot/i }))
    const snapshotInput = await screen.findByLabelText('Snapshot message')
    await userEvent.type(snapshotInput, 'Tailor backend summary')
    const createSnapshotButtons = screen.getAllByRole('button', { name: /create snapshot/i })
    await userEvent.click(createSnapshotButtons[createSnapshotButtons.length - 1])

    await waitFor(() => expect(screen.getByText('Snapshot saved.')).toBeInTheDocument())
    const snapshotBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
    expect(snapshotBody).toEqual({ message: 'Tailor backend summary' })
  })

  it('creates a variant from the new variant dialog', async () => {
    const createdWorkspace = {
      ...baseWorkspace,
      selected: 'backend',
      variants: [
        ...baseWorkspace.variants,
        {
          name: 'backend',
          has_pdf: false,
          state: { hash: 'hash-backend', mtime_ns: 3 },
        },
      ],
    }
    const fetchMock = mockFetch((input, init) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants' && init?.method === 'POST') {
        return jsonResponse(createdWorkspace)
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await userEvent.click(await screen.findByRole('button', { name: /new variant/i }))
    await userEvent.type(await screen.findByLabelText('Variant name'), 'Backend')
    await userEvent.click(screen.getByRole('button', { name: /create variant/i }))

    await waitFor(() => expect(screen.getByText('Variant created.')).toBeInTheDocument())
    const createBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
    expect(createBody).toEqual({ name: 'Backend', source: 'base' })
  })

  it('restores a snapshot from the snapshot action menu', async () => {
    const fetchMock = mockFetch((input, init) => {
      if (String(input) === '/api/workspace') return jsonResponse(baseWorkspace)
      if (String(input) === '/api/variants/base/restore/abc123' && init?.method === 'POST') {
        return jsonResponse(baseWorkspace)
      }
      return jsonResponse({ hash: 'hash-base', mtime_ns: 1 })
    })

    renderApp()

    await userEvent.click(
      await screen.findByRole('button', { name: /snapshot actions for initial resume/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /restore as draft/i }))

    await waitFor(() => expect(screen.getByText('Restored as draft.')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/variants/base/restore/abc123',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
