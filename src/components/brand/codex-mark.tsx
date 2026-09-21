export function CodexMark({ size = 32, className }: Readonly<{ size?: number; className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 48 48"
      width={size}
    >
      <path
        d="M14 7C7.5 11.5 5 16.7 5 24s2.5 12.5 9 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <path
        d="M34 7c6.5 4.5 9 9.7 9 17s-2.5 12.5-9 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <path
        d="M10 25h7l3-7 4 14 4-19 3 12h7"
        stroke="#75e7f2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.35"
      />
      <path
        d="M10 25h7l3-7 4 14 4-19 3 12h7"
        opacity=".28"
        stroke="#d38cf4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4.6"
      />
    </svg>
  );
}
