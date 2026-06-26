import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { EditorView } from '@codemirror/view'
import {
  AlertCircle,
  Clock3,
  Download,
  FileText,
  GitCommitHorizontal,
  Loader2,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
} from 'lucide-react'

import {
  ApiError,
  createVariant,
  getVariantState,
  getWorkspace,
  initWorkspace,
  renderVariant,
  restoreVariant,
  saveResume,
  snapshotVariant,
} from '@/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#fffdf7',
    color: '#181A1F',
    height: '100%',
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    backgroundColor: '#f6f3ea',
    color: '#767064',
    borderRight: '1px solid #d8d2c4',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: '#efe9db',
  },
  '.cm-content': {
    caretColor: '#2D68D8',
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
  const [message, setMessage] = useState<string | null>(null)
  const [renderOutput, setRenderOutput] = useState('')
  const [variantName, setVariantName] = useState('')
  const [snapshotMessage, setSnapshotMessage] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [loading, setLoading] = useState(true)
  const isDesktop = useIsDesktop()

  const selected = workspace?.selected ?? 'base'
  const initialized = workspace?.initialized ?? false

  const draftLabel = useMemo(() => {
    if (diskChanged && dirty) return 'Disk changed; browser has edits'
    if (diskChanged) return 'Disk changed; reload to update'
    if (dirty) return 'Unsaved changes'
    return 'Clean draft'
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
  ) {
    setAction(nextAction)
    setError(null)
    setMessage(null)
    try {
      const result = await mutation()
      onSuccess(result)
      setMessage(successMessage)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setDiskChanged(true)
      }
      if (caught instanceof ApiError && caught.renderOutput) {
        setRenderOutput(caught.renderOutput)
      }
      setError(messageFromError(caught))
    } finally {
      setAction(null)
    }
  }

  async function handleInit() {
    await runMutation('init', initWorkspace, applyWorkspace, 'Workspace initialized.')
  }

  async function handleCreateVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runMutation(
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
    await runMutation(
      'render',
      () => renderVariant(selected),
      (result) => {
        applyWorkspace(result.workspace)
        setRenderOutput(result.output)
      },
      'Rendered preview.',
    )
  }

  async function handleSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runMutation(
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
    await runMutation(
      'restore',
      () => restoreVariant(selected, commit),
      applyWorkspace,
      'Restored as draft.',
    )
  }

  function handleSelectVariant(variant: string) {
    setMessage(null)
    setRenderOutput('')
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
        <TopBar workspacePath={workspace?.workspace_path ?? ''} />
        <section className="mx-auto grid min-h-[calc(100svh-73px)] w-full max-w-5xl place-items-center px-5 py-10">
          <Card className="w-full max-w-xl border-dashed bg-card/90">
            <CardHeader>
              <CardTitle className="font-display text-2xl">Begin with a base resume</CardTitle>
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
              <Button
                className="w-fit"
                disabled={action === 'init'}
                onClick={handleInit}
              >
                {action === 'init' ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Sparkles data-icon="inline-start" />
                )}
                Initialize workspace
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <TopBar workspacePath={workspace?.workspace_path ?? ''} />
      <section className="flex h-[calc(100svh-73px)] flex-col gap-3 p-3 max-lg:h-auto">
        <StatusStrip
          dirtyLabel={draftLabel}
          message={message}
          updatedAt={workspace?.updated_at ?? 'missing'}
          variant={selected}
        />

        {isDesktop ? (
          <WorkbenchLayout
            editor={
              <EditorPanel
                action={action}
                content={editorContent}
                dirty={dirty}
                diskChanged={diskChanged}
                error={error}
                message={message}
                onChange={handleEditorChange}
                onOverwrite={() => void handleSave(true)}
                onRender={handleRender}
                onSave={() => void handleSave(false)}
                onSnapshot={handleSnapshot}
                renderOutput={renderOutput}
                selected={selected}
                setSnapshotMessage={setSnapshotMessage}
                snapshotMessage={snapshotMessage}
                updatedAt={workspace?.updated_at ?? 'missing'}
              />
            }
            preview={
              <PreviewPanel
                pdfUrl={workspace?.pdf_url ?? null}
                previewUrl={workspace?.preview_url ?? null}
                renderOutput={renderOutput}
              />
            }
            variants={
              <VariantPanel
                action={action}
                onCreate={handleCreateVariant}
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
              diskChanged={diskChanged}
              error={error}
              message={message}
              onChange={handleEditorChange}
              onOverwrite={() => void handleSave(true)}
              onRender={handleRender}
              onSave={() => void handleSave(false)}
              onSnapshot={handleSnapshot}
              renderOutput={renderOutput}
              selected={selected}
              setSnapshotMessage={setSnapshotMessage}
              snapshotMessage={snapshotMessage}
              updatedAt={workspace?.updated_at ?? 'missing'}
            />
            <PreviewPanel
              pdfUrl={workspace?.pdf_url ?? null}
              previewUrl={workspace?.preview_url ?? null}
              renderOutput={renderOutput}
            />
          </div>
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

function TopBar({ workspacePath }: { workspacePath: string }) {
  return (
    <header className="flex min-h-[73px] items-center justify-between gap-4 border-b bg-background/95 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Local workbench
        </p>
        <h1 className="font-display text-2xl font-semibold leading-tight">
          Resume Studio
        </h1>
      </div>
      <Tooltip>
        <TooltipTrigger
          className="max-w-[52vw] truncate rounded-md border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground"
          aria-label="Workspace path"
        >
          {workspacePath || 'Workspace not initialized'}
        </TooltipTrigger>
        <TooltipContent>{workspacePath || 'No workspace yet'}</TooltipContent>
      </Tooltip>
    </header>
  )
}

function StatusStrip({
  dirtyLabel,
  message,
  updatedAt,
  variant,
}: {
  dirtyLabel: string
  message: string | null
  updatedAt: string
  variant: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="secondary">variants/{variant}/resume.yaml</Badge>
        <span className="truncate text-muted-foreground">Last changed {updatedAt}</span>
      </div>
      <div className="flex items-center gap-2">
        {message && <span className="text-primary">{message}</span>}
        <Badge variant={dirtyLabel === 'Clean draft' ? 'outline' : 'default'}>
          {dirtyLabel}
        </Badge>
      </div>
    </div>
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
        tone === 'neutral' && 'bg-muted-foreground/35',
      )}
    />
  )
}

function VariantPanel({
  action,
  onCreate,
  onRestore,
  onSelect,
  selected,
  setVariantName,
  variantName,
  workspace,
}: {
  action: Action
  onCreate: (event: FormEvent<HTMLFormElement>) => void
  onRestore: (commit: string) => void
  onSelect: (variant: string) => void
  selected: string
  setVariantName: (value: string) => void
  variantName: string
  workspace: Workspace | null
}) {
  return (
    <Card className="h-full rounded-lg">
      <CardHeader>
        <CardTitle>Variants</CardTitle>
        <CardDescription>Tailored resumes from one base document.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <ScrollArea className="min-h-36 flex-1 pr-3">
          <nav className="flex flex-col gap-1" aria-label="Resume variants">
            {workspace?.variants.map((variant) => (
              <button
                className={cn(
                  'grid grid-cols-[4px_1fr] gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted',
                  variant.name === selected && 'bg-primary/10',
                )}
                key={variant.name}
                onClick={() => onSelect(variant.name)}
                type="button"
              >
                <RevisionRail tone={variant.name === selected ? 'blue' : 'neutral'} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{variant.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {variant.has_pdf ? 'Preview ready' : 'No preview'}
                  </span>
                </span>
              </button>
            ))}
          </nav>
        </ScrollArea>

        <Separator />

        <form className="flex flex-col gap-3" onSubmit={onCreate}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="variant-name">New variant</FieldLabel>
              <Input
                autoComplete="off"
                id="variant-name"
                onChange={(event) => setVariantName(event.target.value)}
                placeholder="openai-backend"
                value={variantName}
              />
              <FieldDescription>Copies from the selected variant.</FieldDescription>
            </Field>
          </FieldGroup>
          <Button disabled={action === 'create'} type="submit" variant="secondary">
            {action === 'create' ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            New variant
          </Button>
        </form>

        <Separator />

        <section className="flex min-h-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="font-medium">History</h2>
            <p className="text-sm text-muted-foreground">Snapshots for this variant.</p>
          </div>
          <ScrollArea className="min-h-36 flex-1 pr-3">
            {workspace?.history.length ? (
              <ol className="flex flex-col gap-3">
                {workspace.history.map((entry) => (
                  <li className="grid grid-cols-[4px_1fr] gap-3" key={entry.commit}>
                    <RevisionRail />
                    <div className="min-w-0 rounded-md border bg-background p-2">
                      <p className="truncate text-sm font-medium">{entry.message}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {entry.date} · {entry.short_commit}
                      </p>
                      <Button
                        className="mt-2 px-0"
                        disabled={action === 'restore'}
                        onClick={() => onRestore(entry.commit)}
                        size="sm"
                        type="button"
                        variant="link"
                      >
                        <RotateCcw data-icon="inline-start" />
                        Restore as draft
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No snapshots for this variant yet.
              </p>
            )}
          </ScrollArea>
        </section>
      </CardContent>
    </Card>
  )
}

function EditorPanel({
  action,
  content,
  dirty,
  diskChanged,
  error,
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
  diskChanged: boolean
  error: string | null
  message: string | null
  onChange: (value: string) => void
  onOverwrite: () => void
  onRender: () => void
  onSave: () => void
  onSnapshot: (event: FormEvent<HTMLFormElement>) => void
  renderOutput: string
  selected: string
  setSnapshotMessage: (value: string) => void
  snapshotMessage: string
  updatedAt: string
}) {
  return (
    <Card className="h-full rounded-lg">
      <CardHeader>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Editing
          </p>
          <CardTitle className="font-mono text-sm">variants/{selected}/resume.yaml</CardTitle>
        </div>
        <CardAction>
          <Button disabled={action === 'render'} onClick={onRender} type="button" variant="outline">
            {action === 'render' ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <PanelRightOpen data-icon="inline-start" />
            )}
            Render preview
          </Button>
        </CardAction>
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
        <div className="min-h-[460px] flex-1 overflow-hidden rounded-lg border bg-background">
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={action === 'save'} onClick={onSave} type="button">
              {action === 'save' ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              Save changes
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
          <Badge variant={dirty ? 'default' : 'outline'}>
            {dirty ? 'Unsaved changes' : 'Clean draft'}
          </Badge>
        </div>
        <Separator />
        <form className="flex flex-wrap gap-2" onSubmit={onSnapshot}>
          <Input
            aria-label="Snapshot message"
            className="min-w-64 flex-1"
            onChange={(event) => setSnapshotMessage(event.target.value)}
            placeholder="Snapshot message, e.g. Tailor backend summary"
            value={snapshotMessage}
          />
          <Button disabled={action === 'snapshot'} type="submit" variant="secondary">
            {action === 'snapshot' ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <GitCommitHorizontal data-icon="inline-start" />
            )}
            Snapshot version
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PreviewPanel({
  pdfUrl,
  previewUrl,
  renderOutput,
}: {
  pdfUrl: string | null
  previewUrl: string | null
  renderOutput: string
}) {
  return (
    <Card className="h-full rounded-lg">
      <CardHeader>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Final artifact
          </p>
          <CardTitle>PDF Preview</CardTitle>
        </div>
        {pdfUrl && (
          <CardAction>
            <a
              className={buttonVariants({ variant: 'outline' })}
              href={pdfUrl}
              rel="noreferrer"
              target="_blank"
            >
              <Download data-icon="inline-start" />
              Export PDF
            </a>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {renderOutput && (
          <pre className="max-h-44 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs text-muted-foreground">
            {renderOutput}
          </pre>
        )}
        {previewUrl ? (
          <div className="min-h-[520px] flex-1 overflow-auto rounded-lg border bg-white p-3">
            <img
              alt="Rendered resume preview"
              className="mx-auto h-auto max-w-full rounded-sm shadow-sm"
              src={previewUrl}
            />
          </div>
        ) : (
          <div className="grid min-h-[420px] flex-1 place-items-center rounded-lg border border-dashed bg-background p-6 text-center">
            <div className="flex max-w-xs flex-col items-center gap-3 text-muted-foreground">
              {pdfUrl ? <FileText /> : <RevisionRail />}
              <p>
                {pdfUrl
                  ? 'RenderCV did not produce an image preview for this PDF.'
                  : 'Render this variant to preview the PDF.'}
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

export default App
