export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#E36A1E" />
      <rect x="12" y="9" width="8" height="15" rx="4" fill="#fff" />
      <path d="M16 6.2c1.1 1.5 2 2.6 2 3.8A2 2 0 0 1 16 12a2 2 0 0 1-2-2c0-1.2.9-2.3 2-3.8z" fill="#0E2436" />
    </svg>
  )
}
