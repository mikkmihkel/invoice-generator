import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { useRef } from 'react'
import { useApp } from '../../AppContext'
import { fieldId } from '../../components/fields'
import { IconButton } from '../../components/ui'

const focusById = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())

/**
 * Free-text rows printed before or after the invoice lines (`Invoice.textBefore` / `textAfter`): a quiet
 * "add" control, then one auto-growing text box per row with reorder and remove. Read-only it shows only the
 * rows that will be printed.
 */
export function TextRows({
  kind,
  rows,
  onChange,
  disabled,
  quote,
}: {
  kind: 'before' | 'after'
  rows: string[] | undefined
  onChange: (rows: string[] | undefined) => void
  disabled?: boolean
  /** Word the labels for a quote ("pakkumise read") instead of an invoice. */
  quote?: boolean
}) {
  const { t } = useApp()
  const addBtn = useRef<HTMLButtonElement>(null)
  const path = kind === 'before' ? 'textBefore' : 'textAfter'
  const label = quote ? t(kind === 'before' ? 'quote.textBefore' : 'quote.textAfter') : t(kind === 'before' ? 'editor.textBefore' : 'editor.textAfter')
  const list = rows ?? []
  const labelId = `${path}-label`

  if (disabled) {
    const printed = list.filter((r) => r.trim() !== '')
    if (!printed.length) return null
    return (
      <div className={`text-rows text-rows-${kind} text-rows-ro`} role="group" aria-labelledby={labelId}>
        <p className="text-rows-label" id={labelId}>
          {label}
        </p>
        {printed.map((r, i) => (
          <p key={i} className="text-row-ro">
            {r}
          </p>
        ))}
      </div>
    )
  }

  const commit = (next: string[]) => onChange(next.length ? next : undefined)
  const add = () => {
    commit([...list, ''])
    focusById(fieldId(`${path}.${list.length}`))
  }
  const remove = (i: number) => {
    commit(list.filter((_, j) => j !== i))
    if (list.length > 1) focusById(fieldId(`${path}.${Math.max(0, i - 1)}`))
    else requestAnimationFrame(() => addBtn.current?.focus())
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
    focusById(`${path}-${dir < 0 ? 'up' : 'down'}-${j}`)
  }

  return (
    <div className={`text-rows text-rows-${kind}${list.length ? ' has-rows' : ''}`}>
      {list.length > 0 && (
        <div role="group" aria-labelledby={labelId}>
          <p className="text-rows-label" id={labelId}>
            {label}
          </p>
          <ol className="text-rows-list">
            {list.map((r, i) => (
              <li key={i} className="text-row">
                <textarea
                  id={fieldId(`${path}.${i}`)}
                  rows={1}
                  value={r}
                  aria-label={t('editor.textRowN', { label, n: i + 1 })}
                  placeholder={t(kind === 'before' ? 'editor.textBeforeHint' : 'editor.textAfterHint')}
                  onChange={(e) => commit(list.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <div className="text-row-tools">
                  {list.length > 1 && (
                    <>
                      <IconButton id={`${path}-up-${i}`} className="icon-btn-sm" onClick={() => move(i, -1)} disabled={i === 0} label={t('editor.textRowUp', { label, n: i + 1 })} icon={<ArrowUpIcon size={14} />} />
                      <IconButton
                        id={`${path}-down-${i}`}
                        className="icon-btn-sm"
                        onClick={() => move(i, 1)}
                        disabled={i === list.length - 1}
                        label={t('editor.textRowDown', { label, n: i + 1 })}
                        icon={<ArrowDownIcon size={14} />}
                      />
                    </>
                  )}
                  <IconButton className="icon-btn-sm icon-btn-danger" onClick={() => remove(i)} label={t('editor.textRowRemove', { label, n: i + 1 })} icon={<XIcon size={14} />} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      <button ref={addBtn} type="button" className="ed-text-btn ed-text-btn-quiet" onClick={add}>
        <PlusIcon />
        {quote ? t(kind === 'before' ? 'quote.addTextBefore' : 'quote.addTextAfter') : t(kind === 'before' ? 'editor.addTextBefore' : 'editor.addTextAfter')}
      </button>
    </div>
  )
}
