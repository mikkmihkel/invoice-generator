import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProfile } from '../../../domain'
import { AppProvider } from '../../AppContext'
import { createMemoryRepo, sampleProfile } from '../../testing/memoryRepo'
import { BrandColors, ColorField, TemplatePicker, type BrandColorsValue } from '../Appearance'
import { isLowContrast, parseHexInput, suggestSecondary } from './colors'
import { designSampleInvoice } from './sampleInvoice'

vi.mock('../../../storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../storage')>()),
  subscribe: () => () => undefined,
}))

afterEach(cleanup)

const wrap = (ui: ReactNode) => render(<AppProvider repository={createMemoryRepo()}>{ui}</AppProvider>)

describe('colour helpers', () => {
  it('parses typed hex codes', () => {
    expect(parseHexInput(' 1F6B4A ')).toBe('#1f6b4a')
    expect(parseHexInput('#E07A10')).toBe('#e07a10')
    for (const bad of ['#fff', 'red', '#12345g', 'url(x)', '#1f6b4a;']) expect(parseHexInput(bad)).toBeNull()
  })

  it('flags colours too light for text on white', () => {
    expect(isLowContrast('#f5c542')).toBe(true)
    expect(isLowContrast('#1f4e79')).toBe(false)
    expect(isLowContrast('nonsense')).toBe(false)
  })

  it('suggests a secondary colour different from the primary', () => {
    expect(suggestSecondary('#0b5d7a', ['#0B5D7A', '#1f4e79', '#e07a10'])).toBe('#e07a10')
    expect(suggestSecondary('#1f4e79', ['#0b5d7a'])).toBe('#c2410c')
    expect(suggestSecondary('#0b5d7a', ['url(x)'])).toBe('#c2410c')
  })
})

describe('ColorField', () => {
  it('accepts valid hex only and reports invalid input on blur', () => {
    const onChange = vi.fn()
    wrap(<ColorField label="Põhivärv" value="#1f4e79" onChange={onChange} />)
    const hex = screen.getByLabelText('Põhivärv')
    expect(hex).toHaveValue('#1F4E79')
    fireEvent.change(hex, { target: { value: '#e07a1' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(hex)
    expect(hex).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('#RRGGBB')
    fireEvent.change(hex, { target: { value: 'E07A10' } })
    expect(onChange).toHaveBeenLastCalledWith('#e07a10')
  })

  it('offers presets and extra (logo) swatches', () => {
    const onChange = vi.fn()
    wrap(<ColorField label="Põhivärv" value="#1f4e79" onChange={onChange} extraSwatches={['#0A7F6E', 'url(https://evil.example/x)']} extraLabel="Logost" />)
    expect(screen.getByRole('group', { name: 'Logost' }).querySelectorAll('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Kasuta värvi #0A7F6E' }))
    expect(onChange).toHaveBeenCalledWith('#0a7f6e')
    expect(screen.getByRole('button', { name: 'Kasuta värvi #1F4E79' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('never puts an unsafe value into the colour inputs or styles', () => {
    wrap(<ColorField label="Põhivärv" value="red;background:url(https://evil.example/x)" onChange={() => undefined} />)
    expect(screen.getByLabelText('Põhivärv')).toHaveValue('#1F4E79')
    expect(document.body.innerHTML).not.toContain('evil.example')
  })
})

function Harness({ initial, logo }: { initial: BrandColorsValue; logo?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <BrandColors value={value} onChange={(patch) => setValue((v) => ({ ...v, ...patch }))} logoDataUrl={logo} />
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  )
}
const state = () => JSON.parse(screen.getByTestId('state').textContent!) as BrandColorsValue

describe('BrandColors', () => {
  it('switches between mono, accent and duo', () => {
    wrap(<Harness initial={{ accentColor: '#0b5d7a' }} />)
    expect(screen.getByRole('radio', { name: 'Ühevärviline' })).toBeChecked()
    expect(screen.getByLabelText('Põhivärv', { selector: 'input.color-hex' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Lisavärv')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'Kahevärviline' }))
    expect(state()).toMatchObject({ colorMode: 'duo', secondaryColor: '#c2410c' })
    expect(screen.getByLabelText('Lisavärv')).toHaveValue('#C2410C')

    fireEvent.click(screen.getByRole('radio', { name: 'Mustvalge' }))
    expect(state().colorMode).toBe('mono')
    expect(screen.queryByLabelText('Lisavärv')).toBeNull()
    expect(screen.getByText(/Värviline on vaid logo/)).toBeInTheDocument()
    // The colours are kept for when the user switches back.
    expect(state().secondaryColor).toBe('#c2410c')
  })

  it('warns quietly about a primary colour too light for text', () => {
    wrap(<Harness initial={{ accentColor: '#f5c542' }} />)
    expect(screen.getByText(/tehakse tekst arvel automaatselt tumedamaks/)).toBeInTheDocument()
  })

  it('offers logo colours only when there is a logo', () => {
    wrap(<Harness initial={{ accentColor: '#0b5d7a' }} />)
    expect(screen.queryByRole('button', { name: 'Võta värvid logost' })).toBeNull()
    cleanup()
    wrap(<Harness initial={{ accentColor: '#0b5d7a' }} logo="data:image/png;base64,AAAA" />)
    expect(screen.getByRole('button', { name: 'Võta värvid logost' })).toBeInTheDocument()
  })
})

describe('TemplatePicker', () => {
  it('is a radio list of the six templates with one-line descriptions and no drawn thumbnails', () => {
    const onChange = vi.fn()
    wrap(<TemplatePicker value="modern" onChange={onChange} accent="#0b5d7a" secondary="url(https://evil.example/x)" mode="duo" />)
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['standard', 'classic', 'modern', 'minimal', 'bold', 'compact'])
    // The name alone labels the radio; the description is announced once, as its description.
    expect(screen.getByRole('radio', { name: 'Moodne' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Moodne' })).toHaveAccessibleDescription('Värviline päiseriba, kus summa on suurelt näha.')
    expect(screen.getByRole('group', { name: 'Kujundus' })).toBeInTheDocument()
    expect(document.querySelector('.tpl-thumb, [style]')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /Julge/ }))
    expect(onChange).toHaveBeenCalledWith('bold')
  })

  it('shares one radio name per picker (arrow keys move within it) and can be disabled', () => {
    wrap(
      <>
        <TemplatePicker value="standard" onChange={() => undefined} accent="#0b5d7a" />
        <TemplatePicker value="classic" onChange={() => undefined} accent="#0b5d7a" disabled compact legend="Arve kujundus" />
      </>,
    )
    const [a, b] = [...document.querySelectorAll('fieldset')].map((f) => [...f.querySelectorAll<HTMLInputElement>('input[type=radio]')])
    expect(new Set(a.map((r) => r.name)).size).toBe(1)
    expect(a[0].name).not.toBe(b[0].name)
    expect(screen.getByRole('group', { name: 'Arve kujundus' })).toBeDisabled()
  })
})

describe('designSampleInvoice', () => {
  it('uses the profile and the chosen design, without a draft watermark', () => {
    const profile = { ...sampleProfile(), logoDataUrl: 'data:image/png;base64,AAAA' }
    const inv = designSampleInvoice(profile, { templateId: 'bold', accentColor: '#0b5d7a', secondaryColor: '#e07a10', colorMode: 'duo' })
    expect(inv).toMatchObject({ status: 'issued', templateId: 'bold', accentColor: '#0b5d7a', secondaryColor: '#e07a10', colorMode: 'duo', issueDate: '2026-10-14' })
    expect(inv.seller.name).toBe(profile.name)
    expect(inv.seller.logoDataUrl).toBe(profile.logoDataUrl)
    expect(inv.number).not.toBe('')
    expect(inv.lines.length).toBeGreaterThan(1)
  })

  it('fills placeholders for an unfinished onboarding profile', () => {
    const p = createDefaultProfile()
    p.defaults.language = 'en'
    const inv = designSampleInvoice(p, { templateId: 'standard', accentColor: '#1f4e79' })
    expect(inv.seller.name).toBe('Your Company Ltd')
    expect(inv.buyer.name).toBe('Sample Client Ltd')
    expect(inv).not.toHaveProperty('colorMode')
    expect(inv.dueDate).toBe('2026-10-28')
  })
})
