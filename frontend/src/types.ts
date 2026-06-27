export type FileState = {
  hash: string
  mtime_ns: number
}

export type Variant = {
  name: string
  has_pdf: boolean
  state: FileState | null
}

export type HistoryEntry = {
  commit: string
  short_commit: string
  date: string
  message: string
}

export type Workspace = {
  workspace_path: string
  initialized: boolean
  variants: Variant[]
  selected: string
  content: string
  state: FileState | null
  updated_at: string
  history: HistoryEntry[]
  pdf_url: string | null
  preview_urls: string[]
}

export type RenderResult = {
  workspace: Workspace
  output: string
}
