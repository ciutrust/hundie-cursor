/** Small Amazon smile logo for nav / desk header (not an official trademark asset). */
export function AmazonLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M13.2 3.1c-1.1-.2-2.3.1-3.2.7-.7.5-1.2 1.2-1.4 2.1-.1.4.2.8.6.9.4.1.8-.2.9-.6.1-.5.4-.9.8-1.1.6-.4 1.4-.5 2.1-.3.7.2 1.2.7 1.4 1.4.1.4.5.7.9.6.4-.1.7-.5.6-.9-.3-1.2-1.3-2.2-2.7-2.8z"
      />
      <path
        fill="currentColor"
        d="M6.2 10.2c.3-.3.8-.3 1.1 0l2.4 2.3c.4.3.9.5 1.4.5h1.8c.5 0 1-.2 1.4-.5l2.4-2.3c.3-.3.8-.3 1.1 0 .3.3.3.8 0 1.1l-2.4 2.3c-.7.7-1.7 1.1-2.7 1.1h-1.8c-1 0-2-.4-2.7-1.1l-2.4-2.3c-.3-.3-.3-.8 0-1.1z"
      />
      <path
        fill="#FF9900"
        d="M4.2 16.2c2.8 1.7 6.1 2.6 9.5 2.6 2.4 0 4.8-.5 7-1.4.4-.2.8.1.7.5-.8 2.3-4.4 3.9-7.7 3.9-3.8 0-7.3-1.6-9.8-4.2-.3-.3-.1-.8.3-1.4z"
      />
    </svg>
  );
}
