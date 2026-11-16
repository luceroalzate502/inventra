import { useId } from 'react';

/** Botella soplada con la letra I recortada, marca de Invencodi. */
export function BrandMark({ size = 24 }: { size?: number }) {
  const maskId = `brandmark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={maskId}>
          <rect width="24" height="24" fill="#000" />
          <g fill="#fff">
            <rect x="10" y="4.3" width="4.1" height="1.9" rx="0.75" />
            <rect x="10.9" y="6.1" width="2.2" height="2.2" />
            <rect x="8.8" y="8.1" width="6.4" height="10.3" rx="1.9" />
          </g>
          <g fill="#000">
            <rect x="9.75" y="9.4" width="4.5" height="1.4" rx="0.5" />
            <rect x="11.15" y="10.1" width="1.7" height="6.1" rx="0.4" />
            <rect x="9.75" y="15.5" width="4.5" height="1.4" rx="0.5" />
          </g>
        </mask>
      </defs>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
