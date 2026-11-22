import Link from "next/link";

/** Three lines of a transcript, one of them marked: the moment an answer cites. */
export function Mark({ size = 30, tone = "green" }: { size?: number; tone?: "green" | "white" }) {
  const ground = tone === "white" ? "rgb(255 255 255 / 0.14)" : "url(#mnemon-ground)";
  const line = tone === "white" ? "rgb(255 255 255 / 0.9)" : "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="mnemon-ground" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f5843" />
          <stop offset="1" stopColor="#05261d" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={ground} />
      {tone === "white" ? (
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="8.5"
          fill="none"
          stroke="rgb(255 255 255 / 0.3)"
        />
      ) : null}
      <rect x="8" y="9.5" width="16" height="2.4" rx="1.2" fill={line} opacity="0.55" />
      <rect x="8" y="14.8" width="10.5" height="2.4" rx="1.2" fill={line} />
      <circle cx="22.6" cy="16" r="2.6" fill="#9de8c7" />
      <rect x="8" y="20.1" width="13" height="2.4" rx="1.2" fill={line} opacity="0.55" />
    </svg>
  );
}

export function Wordmark({
  href = "/",
  tone = "green",
}: {
  href?: string;
  tone?: "green" | "white";
}) {
  return (
    <Link href={href} className="wordmark" style={tone === "white" ? { color: "#fff" } : undefined}>
      <Mark tone={tone} />
      Mnemon
    </Link>
  );
}
