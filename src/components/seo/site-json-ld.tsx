import { JsonLd } from './json-ld'
import { organizationSchema, websiteSchema } from '@/lib/structured-data'

export function SiteJsonLd() {
  return (
    <>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={websiteSchema()} />
    </>
  )
}
