export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.2" y="4.8" width="5.2" height="14.4" rx="1.7" fill="#bae6fd" />
      <rect x="16.6" y="4.8" width="5.2" height="14.4" rx="1.7" fill="#bae6fd" />
      <rect x="7.1" y="6.7" width="0.6" height="10.6" rx="0.3" fill="#7dd3fc" />
      <rect x="16.3" y="6.7" width="0.6" height="10.6" rx="0.3" fill="#7dd3fc" />
      <rect x="9.9" y="4.3" width="4.2" height="1.9" rx="0.8" fill="currentColor" />
      <rect x="10.9" y="6" width="2.2" height="2.3" fill="currentColor" />
      <rect x="8.8" y="8.1" width="6.4" height="10.3" rx="1.9" fill="currentColor" />
    </svg>
  );
}
