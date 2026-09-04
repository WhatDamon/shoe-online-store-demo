import Link from 'next/link'
import { catalog } from '@/server/catalog/adapter'
import { ProductVisual } from '@/components/shop/product-visual'

interface SeriesCard {
  handle: string
  name: string
  description: string
  representative: {
    title: string
    visual: { palette: readonly string[]; accent: string; views: number }
    construction: {
      pattern: 'lattice' | 'wave' | 'honeycomb'
      density: 0.6 | 0.75 | 0.9
      printedUpper: boolean
    }
  } | null
}

export async function CollectionCards() {
  const collections = await catalog.getCollections()

  const cards: SeriesCard[] = await Promise.all(
    collections.map(async (collection) => {
      const products = await catalog.getProducts({
        collection: collection.handle,
        sort: 'featured',
      })
      const representative = products[0] ?? null
      return {
        handle: collection.handle,
        name: collection.name,
        description: collection.description,
        representative: representative
          ? {
              title: representative.title,
              visual: representative.visual,
              construction: representative.construction,
            }
          : null,
      }
    }),
  )

  return (
    <section id="collections" aria-labelledby="collections-heading" className="bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">Shop by series</p>
        <h2
          id="collections-heading"
          className="mt-3 font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
        >
          Find your everyday pair
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.handle}
              href={`/shop?collection=${card.handle}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
            >
              <div className="overflow-hidden bg-[#f3f1ea]">
                {card.representative ? (
                  <ProductVisual
                    visual={card.representative.visual}
                    name={card.representative.title}
                    construction={card.representative.construction}
                    view="side"
                    className="aspect-[4/3] w-full transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <h3 className="text-[15px] font-medium text-neutral-900">{card.name}</h3>
                <p className="text-[13px] leading-snug text-neutral-500">{card.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
