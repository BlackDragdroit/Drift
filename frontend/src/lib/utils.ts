import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

import type { Status } from '@/api/types'
import { t } from '@/i18n'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMinutes(minutes: number): string {
  if (!minutes) return `0 ${t('common.minutes')}`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} ${t('common.minutes')}`
  if (m === 0) return `${h} ${t('common.hours')}`
  return `${h} ${t('common.hours')} ${m} ${t('common.minutes')}`
}

export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return ''
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, opts)
}

export function daysUntil(isoDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${isoDate}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export const STATUS_COLOR: Record<Status, string> = {
  not_started: 'var(--status-none)',
  in_progress: 'var(--status-progress)',
  understood: 'var(--status-understood)',
  mastered: 'var(--status-mastered)',
}

export const STATUS_ORDER: Status[] = ['not_started', 'in_progress', 'understood', 'mastered']

export function nextStatus(status: Status): Status {
  return STATUS_ORDER[(STATUS_ORDER.indexOf(status) + 1) % STATUS_ORDER.length]
}

export function statusLabel(status: Status) {
  return t(`status.${status}`)
}

export function isDone(status: Status) {
  return status === 'understood' || status === 'mastered'
}

export function difficultyDots(d: number | null | undefined) {
  if (!d) return ''
  return '●'.repeat(d) + '○'.repeat(5 - d)
}

export function hexToRgba(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  }
}

export function downloadJson(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
