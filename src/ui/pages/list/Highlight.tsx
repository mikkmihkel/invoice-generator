/** `text` with the first case-insensitive occurrence of `query` marked (the whole text when `query` is empty). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="hit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}
