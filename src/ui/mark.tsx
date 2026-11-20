export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
      <rect width="128" height="128" rx="28" fill="#1c1915" />
      <path d="M44 22h48v86L68 90 44 108V22z" fill="#f4efe6" />
      <path d="M60 22h16v48l-8-8-8 8V22z" fill="#b8422f" />
    </svg>
  );
}
