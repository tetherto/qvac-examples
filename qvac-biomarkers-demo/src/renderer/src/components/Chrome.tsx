// The window chrome: wordmark, the two tabs, the model chip, the privacy
// chip, and the actions. Present on every screen so the model and privacy
// state are never more than a glance away.
import type { ModelChip } from '@shared/types.js'
import { Book, Chip, ChevronLeft, Person, Sparkle } from './Icons.js'

export type Tab = 'overview' | 'table' | 'categories'

export function Chrome({
  tab,
  onTab,
  model,
  onImport,
  onFoodLibrary,
  onProfile,
  onAsk,
  back
}: {
  tab?: Tab
  onTab?: (t: Tab) => void
  model: ModelChip
  onImport?: () => void
  onFoodLibrary?: () => void
  onProfile?: () => void
  onAsk?: () => void
  back?: { label: string; onClick: () => void }
}): React.JSX.Element {
  return (
    <div className="chrome">
      {/* Leftmost, next to the wordmark. Back belongs where the eye starts a
          line, not at the far end of one. */}
      {back && (
        <button className="back" onClick={back.onClick}>
          <ChevronLeft size={14} color="#7E8E88" />
          {back.label}
        </button>
      )}
      {/* The real QVAC wordmark, not type set to look like it. The DEMO pill is
          deliberate: this ships in the public examples repo and must never be
          mistaken for a product. */}
      <div className="wordmark">
        <img src="./qvac-wordmark.svg" alt="QVAC" />
        <span>BIOMARKERS</span>
        <em className="demo-pill">DEMO</em>
      </div>

      {onTab && (
        <div className="tabs">
          <button className={`tab ${tab === 'overview' ? 'on' : ''}`} onClick={() => onTab('overview')}>
            Overview
          </button>
          <button className={`tab ${tab === 'table' ? 'on' : ''}`} onClick={() => onTab('table')}>
            Table
          </button>
          <button
            className={`tab ${tab === 'categories' ? 'on' : ''}`}
            onClick={() => onTab('categories')}
          >
            Categories
          </button>
        </div>
      )}

      <div className="spacer" />

      {!back && (
        <>
          <ModelBadge model={model} />
          <PrivacyBadge />
          {/* Just "Ask": the model chip two items to the left already names
              MedPsy, and the full label wrapped this button onto three lines. */}
          {onAsk && (
            <button className="btn" onClick={onAsk} title={`Ask ${model.label} about your results`}>
              <Sparkle size={15} color="#16E3C1" />
              Ask
            </button>
          )}
          {/* The label is its own element so a narrow window can drop it and
              leave the icon, which is what stops this row clipping the profile
              button off the right edge at the minimum size. */}
          {onFoodLibrary && (
            <button className="btn" onClick={onFoodLibrary} title="Food Library">
              <Book size={15} color="#16E3C1" />
              <span className="btn-label">Food Library</span>
            </button>
          )}
          {onImport && (
            <button className="btn accent" onClick={onImport}>
              Import
            </button>
          )}
          {onProfile && (
            <button className="avatar" onClick={onProfile} title="Your profile">
              <Person size={17} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

export function ModelBadge({ model }: { model: ModelChip }): React.JSX.Element {
  return (
    <div className="chip" title={`${model.params} parameters, ${model.quantization}, runs on this machine`}>
      <Chip size={13} color="#16E3C1" />
      <span>{model.label}</span>
      <span className="dim">{model.sizeLabel}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 2 }}>
        <span className={`dot sm ${model.cached ? 'green' : 'grey'}`} />
        <span className={model.cached ? 'good' : 'dim'} style={{ fontSize: 11 }}>
          {model.cached ? 'Downloaded' : 'Not downloaded'}
        </span>
      </span>
    </div>
  )
}

export function PrivacyBadge(): React.JSX.Element {
  return (
    <div
      className="chip green-edge"
      title="Your results are parsed, scored and explained on this machine. The only request this app ever makes is fetching a page you paste into the Food Library."
    >
      <span className="dot sm green" />
      <span className="dim">Private · on-device</span>
    </div>
  )
}
