import { BellRingingIcon, CaretRightIcon, HourglassMediumIcon, PaperPlaneTiltIcon, PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { useApp } from '../../AppContext'
import { IconButton } from '../../components/ui'
import { formatDate } from '../../format'
import { attentionIds, type AttentionGroup, type AttentionKey } from './attention'

const HIDDEN_KEY = 'invoice-generator:attentionDismissed'

function readDismissed(): string[] {
  try {
    const raw = sessionStorage.getItem(HIDDEN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeDismissed(ids: string[]): void {
  try {
    sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(ids))
  } catch {
    /* storage unavailable: hidden until the page is reloaded */
  }
}

const ICON: Record<AttentionKey, ReactNode> = {
  overdue: <BellRingingIcon size={16} />,
  unsent: <PaperPlaneTiltIcon size={16} />,
  quotes: <HourglassMediumIcon size={16} />,
  drafts: <PencilSimpleIcon size={16} />,
}

/**
 * "Vajab tähelepanu": one line per kind of task (overdue without a reminder, issued but not sent, quotes about
 * to expire, drafts). A line with one document opens it, a line with several filters the list (`active` marks
 * the line whose filter is on). Hidden when there is nothing to do; "Hide" hides it for this browser session
 * until something new comes up.
 */
export function AttentionStrip({ groups, active, onOpen }: { groups: AttentionGroup[]; active: AttentionKey | null; onOpen: (group: AttentionGroup) => void }) {
  const { t } = useApp()
  const [dismissed, setDismissed] = useState(readDismissed)
  const ids = attentionIds(groups)
  if (ids.length === 0 || ids.every((id) => dismissed.includes(id))) return null

  const hide = () => {
    writeDismissed(ids)
    setDismissed(ids)
  }

  const detail = (g: AttentionGroup): string => {
    const one = g.docs.length === 1 ? g.docs[0] : undefined
    const client = one ? one.buyer.name || t('list.noClient') : ''
    switch (g.key) {
      case 'quotes':
        return one ? t('attention.quoteOne', { client, date: formatDate(one.validUntil) }) : t('attention.quotesMany', { count: g.docs.length })
      case 'drafts': {
        const recurring = g.recurringToday ?? 0
        if (one) return recurring ? t('attention.draftRecurringOne', { client }) : client
        const base = t('attention.draftsMany', { count: g.docs.length })
        return recurring ? `${base}, ${recurring === 1 ? t('attention.recurringTodayOne') : t('attention.recurringToday', { count: recurring })}` : base
      }
      default:
        return one ? client : t('attention.invoicesMany', { count: g.docs.length })
    }
  }

  return (
    <section className="attention" aria-labelledby="attention-title">
      <div className="attention-head">
        <h2 id="attention-title">{t('attention.title')}</h2>
        <IconButton label={t('attention.hide')} icon={<XIcon size={14} />} className="icon-btn-sm" onClick={hide} />
      </div>
      <ul>
        {groups.map((g) => {
          const filters = g.docs.length > 1
          return (
            <li key={g.key}>
              <button
                type="button"
                className={`attention-item attention-${g.key}`}
                aria-pressed={filters ? active === g.key : undefined}
                onClick={() => onOpen(g)}
              >
                <span className="attention-icon" aria-hidden="true">
                  {ICON[g.key]}
                </span>
                <span className="attention-text">
                  <span className="attention-label">{t(g.docs.length === 1 && (g.key === 'drafts' || g.key === 'quotes') ? `attention.${g.key}One` : `attention.${g.key}`)}
                    <span className="visually-hidden">:</span>
                  </span>{' '}
                  <span className="attention-detail">{detail(g)}</span>
                </span>
                <CaretRightIcon size={14} className="attention-caret" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
