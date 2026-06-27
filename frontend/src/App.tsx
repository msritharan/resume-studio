import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { EditorView } from '@codemirror/view'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Clock3,
  Search,
  Download,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  MoreHorizontal,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'

import {
  ApiError,
  createVariant,
  deleteVariant,
  getVariantState,
  getWorkspace,
  initWorkspace,
  renderVariant,
  restoreVariant,
  saveResume,
  snapshotVariant,
} from '@/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Workspace } from '@/types'

type Action =
  | 'init'
  | 'create'
  | 'delete'
  | 'save'
  | 'overwrite'
  | 'render'
  | 'snapshot'
  | 'restore'
  | null

const LEFT_PANE = { default: 320, min: 220, max: 560 }
const PREVIEW_PANE = { default: 430, min: 320, max: 760 }
const EDITOR_MIN_WIDTH = 420
const RESIZE_HANDLE_WIDTH = 10
type RenderStatus = 'idle' | 'success' | 'error'

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#ffffff',
    color: '#18201D',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    backgroundColor: '#F7F8F5',
    color: '#68716D',
    borderRight: '1px solid #DCE2DD',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: '#EEF3EF',
  },
  '.cm-content': {
    caretColor: '#0F6B5F',
  },
  '&.cm-focused': {
    outline: '2px solid color-mix(in oklch, var(--ring), transparent 45%)',
    outlineOffset: '-2px',
  },
})

function useIsDesktop(breakpoint = '(min-width: 1024px)') {
  const getMatches = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(breakpoint).matches
      : false

  const [matches, setMatches] = useState(getMatches)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia(breakpoint)
    const sync = (event?: MediaQueryListEvent) => {
      setMatches(event ? event.matches : mediaQuery.matches)
    }

    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [breakpoint])

  return matches
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [expectedHash, setExpectedHash] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [diskChanged, setDiskChanged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [renderOutput, setRenderOutput] = useState('')
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle')
  const [renderDialogOpen, setRenderDialogOpen] = useState(false)
  const [variantName, setVariantName] = useState('')
  const [snapshotMessage, setSnapshotMessage] = useState('')
  const [workspacePathInput, setWorkspacePathInput] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [loading, setLoading] = useState(true)
  const isDesktop = useIsDesktop()

  const selected = workspace?.selected ?? 'base'
  const initialized = workspace?.initialized ?? false

  const draftLabel = useMemo(() => {
    if (diskChanged && dirty) return 'Disk changed with browser edits'
    if (diskChanged) return 'Disk changed'
    if (dirty) return 'Unsaved changes'
    return null
  }, [dirty, diskChanged])

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (!initialized || !selected || !expectedHash) return
    const timer = window.setInterval(async () => {
      try {
        const state = await getVariantState(selected)
        if (state.hash && state.hash !== expectedHash) {
          setDiskChanged(true)
        }
      } catch {
        // Resume Studio is local; failed polling should not disturb editing.
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [expectedHash, initialized, selected])

  async function loadWorkspace(variant?: string) {
    setLoading(true)
    setError(null)
    try {
      applyWorkspace(await getWorkspace(variant))
    } catch (caught) {
      setError(messageFromError(caught))
    } finally {
      setLoading(false)
    }
  }

  function applyWorkspace(next: Workspace) {
    setWorkspace(next)
    setEditorContent(next.content)
    setExpectedHash(next.state?.hash ?? null)
    setDirty(false)
    setDiskChanged(false)
    if (!next.initialized) {
      setWorkspacePathInput(next.workspace_path)
    }
  }

  function messageFromError(caught: unknown) {
    if (caught instanceof ApiError) return caught.message
    if (caught instanceof Error) return caught.message
    return 'Something went wrong.'
  }

  async function runMutation<T>(
    nextAction: Action,
    mutation: () => Promise<T>,
    onSuccess: (result: T) => void,
    successMessage: string,
  ): Promise<boolean> {
    setAction(nextAction)
    setError(null)
    setMessage(null)
    if (nextAction === 'render') {
      setRenderOutput('')
      setRenderError(null)
      setRenderStatus('idle')
      setRenderDialogOpen(false)
    }
    try {
      const result = await mutation()
      onSuccess(result)
      setMessage(successMessage)
      if (nextAction === 'render') {
        setRenderStatus('success')
        setRenderDialogOpen(true)
      }
      return true
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setDiskChanged(true)
      }
      if (caught instanceof ApiError && caught.renderOutput) {
        setRenderOutput(caught.renderOutput)
      }
      const errorMessage = messageFromError(caught)
      if (nextAction === 'render') {
        setRenderStatus('error')
        setRenderError(errorMessage)
        setRenderDialogOpen(true)
      } else {
        setError(errorMessage)
      }
      return false
    } finally {
      setAction(null)
    }
  }

  async function handleInit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runMutation(
      'init',
      () => initWorkspace(workspacePathInput),
      applyWorkspace,
      'Workspace initialized.',
    )
  }

  async function handleCreateVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return runMutation(
      'create',
      () => createVariant(variantName, selected),
      (next) => {
        applyWorkspace(next)
        setVariantName('')
      },
      'Variant created.',
    )
  }

  async function handleSave(force = false) {
    await runMutation(
      force ? 'overwrite' : 'save',
      () => saveResume(selected, editorContent, expectedHash, force),
      applyWorkspace,
      force ? 'Disk file overwritten.' : 'Saved changes.',
    )
  }

  async function handleRender() {
    if (dirty) {
      const saved = await runMutation(
        'save',
        () => saveResume(selected, editorContent, expectedHash, false),
        applyWorkspace,
        'Saved changes.',
      )
      if (!saved) return
    }

    await runMutation(
      'render',
      () => renderVariant(selected),
      (result) => {
        applyWorkspace(result.workspace)
        setRenderOutput(result.output)
      },
      'Preview rendered.',
    )
  }

  async function handleSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return runMutation(
      'snapshot',
      () => snapshotVariant(selected, snapshotMessage),
      (next) => {
        applyWorkspace(next)
        setSnapshotMessage('')
      },
      'Snapshot saved.',
    )
  }

  async function handleRestore(commit: string) {
    return runMutation(
      'restore',
      () => restoreVariant(selected, commit),
      applyWorkspace,
      'Restored as draft.',
    )
  }

  async function handleDeleteVariant(variant: string, next?: string) {
    return runMutation(
      'delete',
      () => deleteVariant(variant, next),
      applyWorkspace,
      'Variant deleted.',
    )
  }

  function handleSelectVariant(variant: string) {
    setMessage(null)
    setRenderOutput('')
    setRenderError(null)
    setRenderStatus('idle')
    setRenderDialogOpen(false)
    void loadWorkspace(variant)
  }

  function handleEditorChange(value: string) {
    setEditorContent(value)
    setDirty(value !== workspace?.content)
  }

  if (loading && !workspace) {
    return <LoadingShell />
  }

  if (!initialized) {
    return (
      <main className="min-h-svh bg-background text-foreground">
        <TopBar filePath="" workspacePath={workspace?.workspace_path ?? ''} />
        <section className="mx-auto grid min-h-[calc(100svh-73px)] w-full max-w-5xl place-items-center px-5 py-10">
          <Card className="w-full max-w-xl border-dashed bg-card/90">
            <CardHeader>
              <CardTitle className="type-title">Begin with a base resume</CardTitle>
              <CardDescription>
                Initialize a local RenderCV workspace with a base YAML resume and Git
                snapshots.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Could not initialize</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <form className="flex flex-col gap-4" onSubmit={handleInit}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="workspace-directory">
                      Workspace directory
                    </FieldLabel>
                    <div className="relative">
                      <FolderOpen
                        aria-hidden="true"
                        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        id="workspace-directory"
                        autoComplete="off"
                        className="h-10 pl-8 font-mono text-sm"
                        disabled={action === 'init'}
                        onChange={(event) => setWorkspacePathInput(event.target.value)}
                        value={workspacePathInput}
                      />
                    </div>
                    <FieldDescription>
                      Resume Studio will create the base variant and Git history in this
                      folder.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
                <Button className="w-fit" disabled={action === 'init'} type="submit">
                  {action === 'init' ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Sparkles data-icon="inline-start" />
                  )}
                  Initialize workspace
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <TopBar
        filePath={`variants/${selected}/resume.yaml`}
        workspacePath={workspace?.workspace_path ?? ''}
      />
      <section className="flex h-[calc(100svh-73px)] flex-col gap-3 p-3 max-lg:h-auto">
        {isDesktop ? (
          <WorkbenchLayout
            editor={
              <EditorPanel
                action={action}
                content={editorContent}
                dirty={dirty}
                dirtyLabel={draftLabel}
                diskChanged={diskChanged}
                error={error}
                message={message}
                onChange={handleEditorChange}
                onOverwrite={() => void handleSave(true)}
                onRender={handleRender}
                onSave={() => void handleSave(false)}
                onSnapshot={handleSnapshot}
                selected={selected}
                setSnapshotMessage={setSnapshotMessage}
                snapshotMessage={snapshotMessage}
              />
            }
            preview={
              <PreviewPanel
                error={renderError}
                isDesktop={isDesktop}
                pdfUrl={workspace?.pdf_url ?? null}
                previewUrls={workspace?.preview_urls ?? []}
                renderStatus={renderStatus}
              />
            }
            variants={
              <VariantPanel
                action={action}
                onCreate={handleCreateVariant}
                onDelete={handleDeleteVariant}
                onRestore={handleRestore}
                onSelect={handleSelectVariant}
                selected={selected}
                setVariantName={setVariantName}
                variantName={variantName}
                workspace={workspace}
              />
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <VariantPanel
              action={action}
              onCreate={handleCreateVariant}
              onDelete={handleDeleteVariant}
              onRestore={handleRestore}
              onSelect={handleSelectVariant}
              selected={selected}
              setVariantName={setVariantName}
              variantName={variantName}
              workspace={workspace}
            />
            <EditorPanel
              action={action}
              content={editorContent}
              dirty={dirty}
              dirtyLabel={draftLabel}
              diskChanged={diskChanged}
              error={error}
              message={message}
              onChange={handleEditorChange}
              onOverwrite={() => void handleSave(true)}
              onRender={handleRender}
              onSave={() => void handleSave(false)}
              onSnapshot={handleSnapshot}
              selected={selected}
              setSnapshotMessage={setSnapshotMessage}
              snapshotMessage={snapshotMessage}
            />
            <PreviewPanel
              error={renderError}
              isDesktop={isDesktop}
              pdfUrl={workspace?.pdf_url ?? null}
              previewUrls={workspace?.preview_urls ?? []}
              renderStatus={renderStatus}
            />
          </div>
        )}

        {renderDialogOpen && (
          <RenderResultDialog
            error={renderError}
            onClose={() => setRenderDialogOpen(false)}
            output={renderOutput}
            status={renderStatus}
          />
        )}
      </section>
    </main>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function WorkbenchLayout({
  editor,
  preview,
  variants,
}: {
  editor: ReactNode
  preview: ReactNode
  variants: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE.default)
  const [previewPaneWidth, setPreviewPaneWidth] = useState(PREVIEW_PANE.default)

  function availableWidth() {
    return containerRef.current?.getBoundingClientRect().width ?? window.innerWidth
  }

  function maxLeftWidth(previewWidth = previewPaneWidth) {
    return Math.min(
      LEFT_PANE.max,
      availableWidth() - previewWidth - EDITOR_MIN_WIDTH - RESIZE_HANDLE_WIDTH * 2,
    )
  }

  function maxPreviewWidth(leftWidth = leftPaneWidth) {
    return Math.min(
      PREVIEW_PANE.max,
      availableWidth() - leftWidth - EDITOR_MIN_WIDTH - RESIZE_HANDLE_WIDTH * 2,
    )
  }

  useEffect(() => {
    const clampToViewport = () => {
      setPreviewPaneWidth((width) => clamp(width, PREVIEW_PANE.min, maxPreviewWidth(leftPaneWidth)))
      setLeftPaneWidth((width) => clamp(width, LEFT_PANE.min, maxLeftWidth(previewPaneWidth)))
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [leftPaneWidth, previewPaneWidth])

  function beginResize(
    pane: 'left' | 'preview',
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault()

    const startX = event.clientX
    const startLeftWidth = leftPaneWidth
    const startPreviewWidth = previewPaneWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX
      if (pane === 'left') {
        setLeftPaneWidth(
          clamp(startLeftWidth + deltaX, LEFT_PANE.min, maxLeftWidth(startPreviewWidth)),
        )
        return
      }

      setPreviewPaneWidth(
        clamp(startPreviewWidth - deltaX, PREVIEW_PANE.min, maxPreviewWidth(startLeftWidth)),
      )
    }

    const stopResize = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  return (
    <div
      className="grid min-h-0 flex-1 rounded-lg"
      ref={containerRef}
      style={{
        gridTemplateColumns: `${leftPaneWidth}px ${RESIZE_HANDLE_WIDTH}px minmax(${EDITOR_MIN_WIDTH}px, 1fr) ${RESIZE_HANDLE_WIDTH}px ${previewPaneWidth}px`,
      }}
    >
      <div className="min-h-0 min-w-0">{variants}</div>
      <ResizeHandle
        label="Resize variants panel"
        onPointerDown={(event) => beginResize('left', event)}
      />
      <div className="min-h-0 min-w-0">{editor}</div>
      <ResizeHandle
        label="Resize preview panel"
        onPointerDown={(event) => beginResize('preview', event)}
      />
      <div className="min-h-0 min-w-0">{preview}</div>
    </div>
  )
}

function ResizeHandle({
  label,
  onPointerDown,
}: {
  label: string
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      className="group flex min-h-0 cursor-col-resize items-center justify-center px-1"
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={0}
    >
      <span className="h-24 w-1.5 rounded-full bg-border transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
    </div>
  )
}

function LoadingShell() {
  return (
    <main className="min-h-svh bg-background p-3">
      <div className="flex h-14 items-center justify-between rounded-lg border bg-card px-4">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="mt-3 grid h-[calc(100svh-85px)] grid-cols-[280px_1fr_420px] gap-3">
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    </main>
  )
}

function TopBar({
  filePath,
  workspacePath,
}: {
  filePath: string
  workspacePath: string
}) {
  const [copied, setCopied] = useState(false)
  const normalizedWorkspacePath = workspacePath.replace(/\/+$/, '')
  const fullPath = filePath
    ? `${normalizedWorkspacePath}/${filePath}`.replace(/\/{2,}/g, '/')
    : normalizedWorkspacePath

  async function handleCopyPath() {
    if (!fullPath) return

    try {
      await navigator.clipboard.writeText(fullPath)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <header className="flex min-h-[73px] items-center justify-between gap-4 border-b bg-card/85 px-4 py-3 shadow-[0_1px_0_rgba(24,32,29,0.03)]">
      <div className="min-w-0">
        <h1 className="type-title text-foreground">Resume Studio</h1>
      </div>
      <div className="flex min-w-0 max-w-[60vw] items-center justify-end gap-2 max-md:max-w-full max-md:w-full max-md:justify-start">
        <Tooltip>
          <TooltipTrigger
            className="flex min-w-0 max-w-full items-center overflow-hidden rounded-lg border bg-background/55 text-left"
            aria-label="Current path"
          >
            {filePath ? <span className="sr-only">{filePath}</span> : null}
            <span className="type-code shrink-0 truncate border-r bg-[color:var(--surface-muted)] px-3 py-1.5 text-foreground max-md:max-w-[55%]">
              {workspacePath || 'Workspace not initialized'}
            </span>
            {filePath ? (
              <span className="type-code min-w-0 truncate bg-background px-3 py-1.5 text-muted-foreground">
                /{filePath}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipContent>{fullPath || 'No workspace yet'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={copied ? 'Path copied' : 'Copy path'}
              className="size-8 shrink-0 rounded-lg"
              disabled={!fullPath}
              onClick={() => void handleCopyPath()}
              size="icon"
              type="button"
              variant="outline"
            >
              {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? 'Copied' : 'Copy full path'}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function RevisionRail({ tone = 'neutral' }: { tone?: 'blue' | 'amber' | 'red' | 'neutral' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block min-h-9 w-1 rounded-full',
        tone === 'blue' && 'bg-primary',
        tone === 'amber' && 'bg-[color:var(--revision-amber)]',
        tone === 'red' && 'bg-destructive',
        tone === 'neutral' && 'bg-border',
      )}
    />
  )
}

function ModalShell({
  children,
  description,
  onClose,
  title,
}: {
  children: ReactNode
  description: string
  onClose: () => void
  title: string
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      aria-describedby="modal-description"
      aria-labelledby="modal-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4"
      role="dialog"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border bg-card p-4 text-card-foreground shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="type-section" id="modal-title">
              {title}
            </h2>
            <p className="type-meta mt-1" id="modal-description">
              {description}
            </p>
          </div>
          <Button aria-label="Close" onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <X />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function VariantPanel({
  action,
  onCreate,
  onDelete,
  onRestore,
  onSelect,
  selected,
  setVariantName,
  variantName,
  workspace,
}: {
  action: Action
  onCreate: (event: FormEvent<HTMLFormElement>) => Promise<boolean>
  onDelete: (variant: string, next?: string) => Promise<boolean>
  onRestore: (commit: string) => Promise<boolean>
  onSelect: (variant: string) => void
  selected: string
  setVariantName: (value: string) => void
  variantName: string
  workspace: Workspace | null
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [openHistoryAction, setOpenHistoryAction] = useState<string | null>(null)
  const [openVariantAction, setOpenVariantAction] = useState<string | null>(null)
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<string | null>(null)
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredVariants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return workspace?.variants ?? []
    return (workspace?.variants ?? []).filter((variant) =>
      variant.name.toLowerCase().includes(query),
    )
  }, [searchQuery, workspace?.variants])

  useEffect(() => {
    if (!openHistoryAction && !openVariantAction && !pendingDeleteVariant) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenHistoryAction(null)
      if (event.key === 'Escape') setOpenVariantAction(null)
      if (event.key === 'Escape') setPendingDeleteVariant(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openHistoryAction, openVariantAction, pendingDeleteVariant])

  useEffect(() => {
    if (!isSearchExpanded) return
    searchInputRef.current?.focus()
  }, [isSearchExpanded])

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    const ok = await onCreate(event)
    if (ok) setCreateOpen(false)
  }

  function closeCreateDialog() {
    setVariantName('')
    setCreateOpen(false)
  }

  function closeDeleteDialog() {
    setPendingDeleteVariant(null)
  }

  function handleSearchBlur() {
    if (!searchQuery) setIsSearchExpanded(false)
  }

  async function handleRestoreFromMenu(commit: string) {
    const ok = await onRestore(commit)
    if (ok) setOpenHistoryAction(null)
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteVariant) return
    const nextVariant =
      pendingDeleteVariant === selected
        ? (() => {
            const index = filteredVariants.findIndex(
              (variant) => variant.name === pendingDeleteVariant,
            )
            return (
              filteredVariants[index + 1]?.name ??
              filteredVariants[index - 1]?.name ??
              workspace?.variants.find((variant) => variant.name === 'base')?.name
            )
          })()
        : selected
    const ok = await onDelete(pendingDeleteVariant, nextVariant)
    if (ok) {
      setPendingDeleteVariant(null)
      setOpenVariantAction(null)
    }
  }

  const canDeleteVariant = (workspace?.variants.length ?? 0) > 1

  return (
    <Card className="h-full rounded-lg shadow-[0_1px_0_rgba(24,32,29,0.03)]">
      <CardHeader>
        <div>
          <CardTitle>Variants</CardTitle>
        </div>
        <CardAction>
          <div className="flex items-center gap-2">
            {(isSearchExpanded || searchQuery) && (
              <div className="relative w-36 min-w-0 sm:w-44">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label="Search variants"
                  autoComplete="off"
                  className="h-8 min-w-0 pl-8"
                  id="variant-search"
                  onBlur={handleSearchBlur}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search variants"
                  ref={searchInputRef}
                  value={searchQuery}
                />
              </div>
            )}
            {!isSearchExpanded && !searchQuery && (
              <Button
                aria-label="Search variants"
                onClick={() => setIsSearchExpanded(true)}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Search />
              </Button>
            )}
            <Button
              aria-label="New variant"
              onClick={() => setCreateOpen(true)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <Plus />
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <ScrollArea className="min-h-32 flex-1 pr-3">
          <nav className="flex flex-col gap-1" aria-label="Resume variants">
            {filteredVariants.map((variant) => (
              <div
                className={cn(
                  'grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/80',
                  variant.name === selected && 'bg-primary/10 text-primary',
                )}
                key={variant.name}
              >
                <button
                  aria-label={variant.name}
                  className="min-w-0 truncate text-left"
                  onClick={() => onSelect(variant.name)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <GitBranch
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground',
                        variant.name === selected && 'text-primary',
                      )}
                    />
                    <span className="type-item-title truncate text-sm text-foreground">
                      {variant.name}
                    </span>
                  </span>
                </button>
                {canDeleteVariant ? (
                  <span className="relative flex items-start">
                    <Button
                      aria-label={`Variant actions for ${variant.name}`}
                      onClick={(event) => {
                        setOpenVariantAction((open) =>
                          open === variant.name ? null : variant.name,
                        )
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <MoreHorizontal />
                    </Button>
                    {openVariantAction === variant.name && (
                      <div className="absolute right-0 top-9 z-10 w-44 rounded-md border bg-popover p-1 shadow-md">
                        <Button
                          className="w-full justify-start text-destructive hover:text-destructive"
                          disabled={action === 'delete'}
                          onClick={(event) => {
                            setPendingDeleteVariant(variant.name)
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {action === 'delete' && pendingDeleteVariant === variant.name ? (
                            <Loader2 data-icon="inline-start" className="animate-spin" />
                          ) : (
                            <Trash2 data-icon="inline-start" />
                          )}
                          Delete variant
                        </Button>
                      </div>
                    )}
                  </span>
                ) : (
                  <span aria-hidden="true" />
                )}
              </div>
            ))}
            {filteredVariants.length === 0 && (
              <p className="type-meta rounded-md border border-dashed p-3">
                No variants match this search.
              </p>
            )}
          </nav>
        </ScrollArea>

        <Separator />

        <section className="flex min-h-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="type-subsection">Snapshots</h2>
          </div>
          <ScrollArea className="min-h-36 flex-1 pr-3">
            {workspace?.history.length ? (
              <ol className="flex flex-col">
                {workspace.history.map((entry) => (
                  <li className="grid grid-cols-[16px_1fr] gap-2.5" key={entry.commit}>
                    <span className="relative flex justify-center">
                      <span className="absolute bottom-0 top-4.5 w-px bg-border" />
                      <span className="relative mt-1 size-2.5 rounded-full border border-primary bg-card" />
                    </span>
                    <div className="relative flex min-w-0 items-start justify-between gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-muted/55">
                      <div className="min-w-0 space-y-0.5 pr-2">
                        <p className="truncate text-[13px] font-medium leading-5 text-foreground">
                          {entry.message}
                        </p>
                        <p className="type-code text-[11px] leading-4 text-muted-foreground">
                          {entry.date} · {entry.short_commit}
                        </p>
                      </div>
                      <Button
                        aria-label={`Snapshot actions for ${entry.message}`}
                        onClick={() =>
                          setOpenHistoryAction((commit) =>
                            commit === entry.commit ? null : entry.commit,
                          )
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <MoreHorizontal />
                      </Button>
                      {openHistoryAction === entry.commit && (
                        <div className="absolute right-1.5 top-8 z-10 w-44 rounded-md border bg-popover p-1 shadow-md">
                          <Button
                            className="w-full justify-start"
                            disabled={action === 'restore'}
                            onClick={() => void handleRestoreFromMenu(entry.commit)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            {action === 'restore' ? (
                              <Loader2 data-icon="inline-start" className="animate-spin" />
                            ) : (
                              <RotateCcw data-icon="inline-start" />
                            )}
                            Restore as draft
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="type-meta rounded-md border border-dashed p-3">
                No snapshots for this variant yet.
              </p>
            )}
          </ScrollArea>
        </section>
        {createOpen && (
          <ModalShell
            description={`Create a new variant from ${selected}.`}
            onClose={closeCreateDialog}
            title="New variant"
          >
            <form className="flex flex-col gap-4" onSubmit={handleCreateSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="variant-name">Variant name</FieldLabel>
                  <Input
                    autoComplete="off"
                    id="variant-name"
                    onChange={(event) => setVariantName(event.target.value)}
                    placeholder="openai-backend"
                    value={variantName}
                  />
                  <FieldDescription>Starts from the current variant.</FieldDescription>
                </Field>
              </FieldGroup>
              <div className="flex justify-end gap-2">
                <Button onClick={closeCreateDialog} type="button" variant="outline">
                  Cancel
                </Button>
                <Button disabled={action === 'create'} type="submit">
                  {action === 'create' ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Plus data-icon="inline-start" />
                  )}
                  Create variant
                </Button>
              </div>
            </form>
          </ModalShell>
        )}
        {pendingDeleteVariant && (
          <ModalShell
            description={`Delete variant "${pendingDeleteVariant}" and remove its files from the workspace.`}
            onClose={closeDeleteDialog}
            title="Delete variant"
          >
            <div className="flex flex-col gap-4">
              <p className="type-meta">
                This action cannot be undone from the variants pane. Snapshots for this
                variant will no longer appear here after deletion.
              </p>
              <div className="flex justify-end gap-2">
                <Button onClick={closeDeleteDialog} type="button" variant="outline">
                  Cancel
                </Button>
                <Button
                  disabled={action === 'delete'}
                  onClick={() => void handleDeleteConfirm()}
                  type="button"
                  variant="destructive"
                >
                  {action === 'delete' ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Trash2 data-icon="inline-start" />
                  )}
                  Delete variant
                </Button>
              </div>
            </div>
          </ModalShell>
        )}
      </CardContent>
    </Card>
  )
}

function EditorPanel({
  action,
  content,
  dirty,
  dirtyLabel,
  diskChanged,
  error,
  message,
  onChange,
  onOverwrite,
  onRender,
  onSave,
  onSnapshot,
  selected,
  setSnapshotMessage,
  snapshotMessage,
}: {
  action: Action
  content: string
  dirty: boolean
  dirtyLabel: string | null
  diskChanged: boolean
  error: string | null
  message: string | null
  onChange: (value: string) => void
  onOverwrite: () => void
  onRender: () => void
  onSave: () => void
  onSnapshot: (event: FormEvent<HTMLFormElement>) => Promise<boolean>
  selected: string
  setSnapshotMessage: (value: string) => void
  snapshotMessage: string
}) {
  const [snapshotOpen, setSnapshotOpen] = useState(false)

  async function handleSnapshotSubmit(event: FormEvent<HTMLFormElement>) {
    const ok = await onSnapshot(event)
    if (ok) setSnapshotOpen(false)
  }

  function closeSnapshotDialog() {
    setSnapshotMessage('')
    setSnapshotOpen(false)
  }

  return (
    <Card className="h-full rounded-lg shadow-[0_1px_0_rgba(24,32,29,0.03)]">
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <CardTitle>Editor</CardTitle>
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-start">
            {message && <span className="type-meta font-medium text-primary">{message}</span>}
            {dirtyLabel && (
              <span className="type-meta inline-flex items-center rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 font-medium text-primary">
                {dirtyLabel}
              </span>
            )}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Action stopped</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {diskChanged && (
          <Alert className="border-[color:var(--revision-amber)]/60">
            <Clock3 />
            <AlertTitle>This file changed on disk</AlertTitle>
            <AlertDescription>
              Reload the variant to pick up the disk version, or overwrite if your browser
              edits should win.
            </AlertDescription>
          </Alert>
        )}
        <div className="min-h-[460px] flex-1 overflow-hidden rounded-lg border bg-card">
          <CodeMirror
            aria-label="Resume YAML editor"
            basicSetup={{
              foldGutter: true,
              highlightActiveLine: true,
              lineNumbers: true,
            }}
            className="h-full"
            extensions={[yaml(), editorTheme]}
            height="100%"
            onChange={onChange}
            value={content}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={action === 'save'} onClick={onSave} type="button">
            {action === 'save' ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            Save changes
          </Button>
          <Button disabled={action === 'render'} onClick={onRender} type="button" variant="outline">
            {action === 'render' ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <PanelRightOpen data-icon="inline-start" />
            )}
            Render preview
          </Button>
          <Button
            disabled={action === 'snapshot'}
            onClick={() => setSnapshotOpen(true)}
            type="button"
            variant="secondary"
          >
            <GitCommitHorizontal data-icon="inline-start" />
            Create snapshot
          </Button>
          {diskChanged && dirty && (
            <Button
              disabled={action === 'overwrite'}
              onClick={onOverwrite}
              type="button"
              variant="destructive"
            >
              {action === 'overwrite' ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <AlertCircle data-icon="inline-start" />
              )}
              Overwrite disk file
            </Button>
          )}
        </div>
        {snapshotOpen && (
          <ModalShell
            description={`Create a Git snapshot for variants/${selected}/resume.yaml.`}
            onClose={closeSnapshotDialog}
            title="Create snapshot"
          >
            <form className="flex flex-col gap-4" onSubmit={handleSnapshotSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="snapshot-message">Snapshot message</FieldLabel>
                  <Input
                    autoComplete="off"
                    id="snapshot-message"
                    onChange={(event) => setSnapshotMessage(event.target.value)}
                    placeholder="Tailor backend summary"
                    value={snapshotMessage}
                  />
                  <FieldDescription>Describe the saved resume change.</FieldDescription>
                </Field>
              </FieldGroup>
              <div className="flex justify-end gap-2">
                <Button onClick={closeSnapshotDialog} type="button" variant="outline">
                  Cancel
                </Button>
                <Button disabled={action === 'snapshot'} type="submit">
                  {action === 'snapshot' ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <GitCommitHorizontal data-icon="inline-start" />
                  )}
                  Create snapshot
                </Button>
              </div>
            </form>
          </ModalShell>
        )}
      </CardContent>
    </Card>
  )
}

function PreviewPanel({
  error,
  isDesktop,
  pdfUrl,
  previewUrls,
  renderStatus,
}: {
  error: string | null
  isDesktop: boolean
  pdfUrl: string | null
  previewUrls: string[]
  renderStatus: RenderStatus
}) {
  const hasPreviewImages = previewUrls.length > 0
  const embeddedPdfUrl = pdfUrl
    ? `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`
    : null

  return (
    <Card className="h-full rounded-lg shadow-[0_1px_0_rgba(24,32,29,0.03)]">
      <CardHeader>
        <div>
          <CardTitle>Preview</CardTitle>
        </div>
        <CardAction className="flex items-center gap-1">
          {pdfUrl && (
            <a
              className={buttonVariants({ variant: 'outline' })}
              href={pdfUrl}
              rel="noreferrer"
              target="_blank"
            >
              <Download data-icon="inline-start" />
              Export PDF
            </a>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {renderStatus === 'error' && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Render failed</AlertTitle>
            <AlertDescription>{error ?? 'RenderCV could not render this variant.'}</AlertDescription>
          </Alert>
        )}
        {pdfUrl || hasPreviewImages ? (
          <div className="min-h-[520px] flex-1 overflow-auto rounded-lg border bg-white p-3">
            {isDesktop && pdfUrl ? (
              <object
                aria-label="Rendered resume PDF"
                className="h-full min-h-[920px] w-full rounded-sm"
                data={embeddedPdfUrl ?? pdfUrl}
                type="application/pdf"
              >
                {hasPreviewImages ? (
                  <div className="space-y-4">
                    {previewUrls.map((previewUrl, index) => (
                      <img
                        key={previewUrl}
                        alt={`Rendered resume preview page ${index + 1}`}
                        className="mx-auto h-auto max-w-full rounded-sm shadow-sm"
                        src={previewUrl}
                      />
                    ))}
                  </div>
                ) : null}
              </object>
            ) : hasPreviewImages ? (
              <div className="space-y-4">
                {previewUrls.map((previewUrl, index) => (
                  <img
                    key={previewUrl}
                    alt={`Rendered resume preview page ${index + 1}`}
                    className="mx-auto h-auto max-w-full rounded-sm shadow-sm"
                    src={previewUrl}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid min-h-[420px] flex-1 place-items-center rounded-lg border border-dashed bg-background p-6 text-center">
            <div className="flex max-w-xs flex-col items-center gap-3 text-center text-muted-foreground">
              {pdfUrl ? <FileText /> : <RevisionRail />}
              <p className="type-meta">
                {pdfUrl
                  ? 'RenderCV did not produce preview images for this PDF.'
                  : 'Render this variant to see the PDF preview.'}
              </p>
              {pdfUrl && (
                <a
                  className={buttonVariants({ variant: 'secondary' })}
                  href={pdfUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open PDF
                </a>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RenderResultDialog({
  error,
  onClose,
  output,
  status,
}: {
  error: string | null
  onClose: () => void
  output: string
  status: RenderStatus
}) {
  const hasLogs = output.trim().length > 0
  const title = status === 'error' ? 'Render failed' : 'Preview rendered.'
  const description =
    status === 'error'
      ? error ?? 'RenderCV could not render this variant.'
      : 'The latest PDF is ready to review or export.'

  return (
    <ModalShell description={description} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        <Alert
          className={status === 'success' ? 'border-primary/25 bg-primary/5' : undefined}
          variant={status === 'error' ? 'destructive' : 'default'}
        >
          {status === 'error' ? <AlertCircle /> : <CheckCircle2 />}
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
        {hasLogs && (
          <div className="flex flex-col gap-2">
            <div className="type-subsection flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Render logs
            </div>
            <pre className="type-code max-h-64 overflow-auto rounded-md border bg-muted/70 p-3 text-muted-foreground">
              {output}
            </pre>
          </div>
        )}
      </div>
    </ModalShell>
  )
}

export default App
