import Link from "next/link";

/** The product name, set in the interface face. No mark: the name is the logo. */
export function Wordmark({
  href = "/",
  tone = "green",
}: {
  href?: string;
  tone?: "green" | "white";
}) {
  return (
    <Link href={href} className="wordmark" style={tone === "white" ? { color: "#fff" } : undefined}>
      Mnemon
    </Link>
  );
}
