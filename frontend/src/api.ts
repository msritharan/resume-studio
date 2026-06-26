import type { RenderResult, Workspace } from '@/types'

type ApiErrorBody = {
  detail?: string
  render_output?: string
}

export class ApiError extends Error {
  status: number
  renderOutput?: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.detail || 'Request failed.')
    this.status = status
    this.renderOutput = body.render_output
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    let body: ApiErrorBody = {}
    try {
      body = await response.json()
    } catch {
      body = { detail: response.statusText }
    }
    throw new ApiError(response.status, body)
  }

  return response.json() as Promise<T>
}

export function getWorkspace(variant?: string) {
  const query = variant ? `?variant=${encodeURIComponent(variant)}` : ''
  return request<Workspace>(`/api/workspace${query}`)
}

export function initWorkspace() {
  return request<Workspace>('/api/init', { method: 'POST', body: '{}' })
}

export function createVariant(name: string, source: string) {
  return request<Workspace>('/api/variants', {
    method: 'POST',
    body: JSON.stringify({ name, source }),
  })
}

export function saveResume(
  variant: string,
  content: string,
  expectedHash: string | null,
  force = false,
) {
  return request<Workspace>(`/api/variants/${encodeURIComponent(variant)}/resume`, {
    method: 'PUT',
    body: JSON.stringify({
      content,
      expected_hash: expectedHash,
      force,
    }),
  })
}

export function renderVariant(variant: string) {
  return request<RenderResult>(`/api/variants/${encodeURIComponent(variant)}/render`, {
    method: 'POST',
    body: '{}',
  })
}

export function snapshotVariant(variant: string, message: string) {
  return request<Workspace>(
    `/api/variants/${encodeURIComponent(variant)}/snapshot`,
    {
      method: 'POST',
      body: JSON.stringify({ message }),
    },
  )
}

export function restoreVariant(variant: string, commit: string) {
  return request<Workspace>(
    `/api/variants/${encodeURIComponent(variant)}/restore/${encodeURIComponent(commit)}`,
    { method: 'POST', body: '{}' },
  )
}

export function getVariantState(variant: string) {
  return request<{ hash: string | null; mtime_ns: number | null }>(
    `/api/variants/${encodeURIComponent(variant)}/state`,
  )
}
