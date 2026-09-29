// The medical notice. A component rather than a copied string, so it cannot
// drift between screens, and never a tooltip, per the product rule.

export function Disclaimer({ text }: { text?: string }): React.JSX.Element {
  return (
    <div className="disclaimer">
      <div className="i">i</div>
      <p>
        {text ??
          'Directional guidance, not medical advice, and never for an emergency. Talk to your doctor.'}
      </p>
    </div>
  )
}
