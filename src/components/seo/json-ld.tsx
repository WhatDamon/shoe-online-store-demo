import type { ReactNode } from 'react'

/**
 * JSON-LD is rendered as a native script so crawlers and answer engines can
 * read the same entity facts that the page presents. Escaping `<` prevents a
 * user-controlled product or article string from closing the script element.
 */
export function JsonLd({ data }: { data: unknown }): ReactNode {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
