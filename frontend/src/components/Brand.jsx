export default function Brand() {
  return (
    <span className="brand">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M9 7h14v18l-3.5-2.4L16 25l-3.5-2.4L9 25z" fill="#fff" />
        <path d="M12.5 12h7M12.5 16h7" stroke="var(--accent)" strokeWidth="1.6" />
      </svg>
      Receipt Scanner
    </span>
  );
}
