import { Fragment } from 'react'
import { useApp } from '../AppContext'
import type { MessageKey } from '../i18n'
import { modKey } from '../shortcuts'
import { Dialog } from './Dialog'

type Row = { keys: string[][]; label: MessageKey }

/** Keys per row: each inner list is one combination (joined with +), alternatives are separated by "/". */
function groups(mod: string): { title: MessageKey; rows: Row[] }[] {
  return [
    {
      title: 'shortcuts.everywhere',
      rows: [
        { keys: [['N']], label: 'shortcuts.newInvoice' },
        { keys: [['/']], label: 'shortcuts.search' },
        { keys: [['?']], label: 'shortcuts.help' },
        { keys: [['Esc']], label: 'shortcuts.close' },
      ],
    },
    {
      title: 'shortcuts.list',
      rows: [
        { keys: [['↑'], ['↓']], label: 'shortcuts.listMove' },
        { keys: [['Home'], ['End']], label: 'shortcuts.listEnds' },
      ],
    },
    {
      title: 'shortcuts.editor',
      rows: [
        { keys: [[mod, 'Enter']], label: 'shortcuts.issue' },
        { keys: [['Tab']], label: 'shortcuts.nextField' },
        { keys: [['Enter']], label: 'shortcuts.addLine' },
        { keys: [['↑'], ['↓'], ['Enter']], label: 'shortcuts.suggestions' },
      ],
    },
  ]
}

/** The list of keyboard shortcuts, opened with "?". */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const { t } = useApp()
  return (
    <Dialog
      title={t('shortcuts.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      focusableBody
      footer={
        <button type="button" className="btn" onClick={onClose} data-autofocus>
          {t('common.close')}
        </button>
      }
    >
      <div className="shortcut-sheet">
        {groups(modKey()).map((g) => (
          <section key={g.title} aria-labelledby={'sc-' + g.title}>
            <h3 id={'sc-' + g.title} className="shortcut-group">
              {t(g.title)}
            </h3>
            <dl className="shortcut-list">
              {g.rows.map((r) => (
                <div key={r.label} className="shortcut-row">
                  <dt>
                    {r.keys.map((combo, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="shortcut-or"> / </span>}
                        {combo.map((k, j) => (
                          <Fragment key={k}>
                            {j > 0 && '+'}
                            <kbd className="kbd">{k}</kbd>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </dt>
                  <dd>{t(r.label)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="muted small">{t('shortcuts.typingNote')}</p>
      </div>
    </Dialog>
  )
}
