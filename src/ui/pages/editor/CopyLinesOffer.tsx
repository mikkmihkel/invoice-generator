import { CopyIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { computeTotals, type Invoice } from '../../../domain'
import { useApp } from '../../AppContext'
import { formatMoney } from '../../format'
import { localTodayISO } from '../../util'
import { monthLabel } from './builders'

/**
 * One-click repeat for a regular client: offered in a draft whose lines are still empty once a buyer with
 * earlier invoices is picked. The caller copies the lines (with undo) and hides the offer once lines exist.
 */
export function CopyLinesOffer({ source, onCopy }: { source: Invoice; onCopy: () => void }) {
  const { t, lang } = useApp()
  const totals = useMemo(() => computeTotals(source), [source])
  const count = source.lines.filter((l) => l.description?.trim() || l.unitPrice).length
  const month = monthLabel(source.issueDate, lang, localTodayISO())
  return (
    <div className="ed-copy-offer">
      <button type="button" className="ed-text-btn" onClick={onCopy}>
        <CopyIcon />
        {t('copyLines.action', { number: source.number, month })}
      </button>
      <span className="ed-copy-offer-meta">{t(count === 1 ? 'copyLines.metaOne' : 'copyLines.meta', { count, amount: formatMoney(totals.gross, source.currency) })}</span>
    </div>
  )
}
