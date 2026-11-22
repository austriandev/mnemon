/** A calm aurora in CSS: three drifting curtains, faint rays, stars and grain. Still under reduced motion. */
export function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora-curtain three" />
      <span className="aurora-curtain one" />
      <span className="aurora-curtain two" />
      <span className="aurora-rays" />
    </div>
  );
}
