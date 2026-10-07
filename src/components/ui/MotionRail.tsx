interface MotionRailProps {
  label: string;
  detail: string;
}

export function MotionRail({ label, detail }: MotionRailProps) {
  return (
    <div aria-hidden="true" className="premium-motion-rail">
      <span className="premium-motion-rail__label">{label}</span>
      <span className="premium-motion-rail__track">
        <span className="premium-motion-rail__signal" />
      </span>
      <span className="premium-motion-rail__detail">{detail}</span>
    </div>
  );
}
