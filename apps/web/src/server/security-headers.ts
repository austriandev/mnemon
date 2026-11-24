// Headers on every response. The app's own pages may ask for the microphone, to record
// a meeting (ADR-0018); the browser still asks the person first. Nothing may use the
// camera or location, and nothing may frame the app.
export const SECURITY_HEADERS: readonly { readonly key: string; readonly value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];
