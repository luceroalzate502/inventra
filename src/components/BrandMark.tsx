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
      <rect x="9.8" y="2.4" width="4.4" height="2.4" rx="0.8" fill="currentColor" />
      <rect x="10.4" y="4.6" width="3.2" height="2.6" fill="currentColor" />
      <rect x="5.6" y="7" width="12.8" height="14.4" rx="3.4" fill="currentColor" />
      <path
        d="M12 10.9c-1.9 2.3-3.1 4-3.1 5.3a3.1 3.1 0 0 0 6.2 0c0-1.3-1.2-3-3.1-5.3z"
        fill="#bae6fd"
      />
    </svg>
  );
}
