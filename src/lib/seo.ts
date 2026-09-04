import { site } from './site'
import type { Metadata } from 'next'

export const baseMetadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: { default: site.name, template: `%s — ${site.name}` },
  description: 'Casual shoes, digitally crafted and printed to order.',
  openGraph: { images: ['/og'], siteName: site.name },
}

export const pageMetadata = (o: Partial<Metadata>): Metadata => ({
  ...baseMetadata,
  ...o,
})
