const HOMEPAGE = 'https://smart-guitar.com'

const links = [
  { label: 'Terms of Service', href: `${HOMEPAGE}/terms.html` },
  { label: 'Privacy', href: `${HOMEPAGE}/privacy.html` },
  { label: 'Refund Policy', href: `${HOMEPAGE}/refund.html` },
]

export function LegalFooter() {
  return (
    <footer className="relative z-10 mt-auto pt-8 pb-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-smoke-500">
      {links.map(({ label, href }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-flame-400 transition-colors"
        >
          {label}
        </a>
      ))}
    </footer>
  )
}
