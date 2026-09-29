// ============================================================
// The profile panel.
//
// Saving changes every effective range, which changes statuses, scores and
// what the model is asked about, so it throws away the whole advice cache.
// The panel says so, rather than letting a user wonder why their
// recommendations reset.
// ============================================================

import { useState } from 'react'
import type { AgeGroup, AppState, Gender, Profile } from '@shared/types.js'
import { AGE_GROUPS } from '@shared/ranges.js'
import { Close, Female, Male } from '../components/Icons.js'

export function ProfileModal({
  state,
  onClose,
  onSave,
  onErase
}: {
  state: AppState
  onClose: () => void
  onSave: (p: Profile) => void
  onErase: () => void
}): React.JSX.Element {
  const [weight, setWeight] = useState(state.profile.weightKg?.toString() ?? '')
  const [height, setHeight] = useState(state.profile.heightCm?.toString() ?? '')
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(state.profile.ageGroup)
  const [gender, setGender] = useState<Gender | null>(state.profile.gender)
  const [confirmErase, setConfirmErase] = useState(false)

  const personalizedCount = state.markers.filter((m) => m.personalized).length

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" style={{ width: 500 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Your profile</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close size={18} />
          </button>
        </header>

        <div className="content">
          <p className="subtle" style={{ margin: '0 0 22px', lineHeight: 1.55 }}>
            These details let QVAC compute{' '}
            <span style={{ color: 'var(--ok)' }}>best-effort personalized ranges</span> for the
            twelve markers where a published interval genuinely moves with gender or age. The other
            44 keep their standard reference range.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">WEIGHT (KG)</label>
                <input
                  value={weight}
                  inputMode="decimal"
                  placeholder="74"
                  onChange={(e) => setWeight(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">HEIGHT (CM)</label>
                <input
                  value={height}
                  inputMode="decimal"
                  placeholder="178"
                  onChange={(e) => setHeight(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="subtle" style={{ fontSize: 11, marginTop: -8 }}>
              Height is what turns a scale export into a BMI, which has a published range where
              raw weight has none. Neither is sent anywhere.
            </div>

            <div>
              <label className="field-label">AGE GROUP</label>
              <div className="seg five">
                {AGE_GROUPS.map((g) => (
                  <button key={g} className={ageGroup === g ? 'on' : ''} onClick={() => setAgeGroup(ageGroup === g ? null : g)}>
                    {g}
                  </button>
                ))}
              </div>
              <div className="subtle" style={{ fontSize: 11, marginTop: 6 }}>
                Only the 60+ group changes anything today, and only for TSH.
              </div>
            </div>

            <div>
              <label className="field-label">GENDER</label>
              <div className="seg two">
                <button
                  className={gender === 'male' ? 'on' : ''}
                  onClick={() => setGender(gender === 'male' ? null : 'male')}
                  aria-label="Male"
                  title="Male"
                >
                  <Male size={18} color={gender === 'male' ? '#16E3C1' : '#7E8E88'} />
                </button>
                <button
                  className={gender === 'female' ? 'on' : ''}
                  onClick={() => setGender(gender === 'female' ? null : 'female')}
                  aria-label="Female"
                  title="Female"
                >
                  <Female size={18} color={gender === 'female' ? '#16E3C1' : '#7E8E88'} />
                </button>
              </div>
            </div>
          </div>

          <div className="disclaimer" style={{ marginTop: 22 }}>
            <div className="i">i</div>
            <p>
              {personalizedCount > 0
                ? `${personalizedCount} markers use a personalized range. Each one shows its source. `
                : ''}
              Personalized ranges are directional and not a substitute for professional medical
              advice. Saving clears cached recommendations, because the advice depends on the range.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                const parsed = weight.trim() === '' ? null : Number(weight)
                const parsedHeight = height.trim() === '' ? null : Number(height)
                onSave({
                  weightKg: parsed != null && Number.isFinite(parsed) ? parsed : null,
                  heightCm: parsedHeight != null && Number.isFinite(parsedHeight) ? parsedHeight : null,
                  ageGroup,
                  gender
                })
              }}
            >
              Save profile
            </button>
          </div>

          <div style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid var(--qvac-border)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, marginBottom: 6 }}>
              Your data lives here
            </div>
            <div className="subtle" style={{ fontSize: 11, wordBreak: 'break-all', marginBottom: 12 }}>
              {state.storePath}
            </div>
            {confirmErase ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="subtle" style={{ fontSize: 12 }}>
                  Delete every reading, source and setting?
                </span>
                <button
                  className="btn"
                  style={{ borderColor: 'var(--bad-line)', color: 'var(--bad)', fontSize: 12, padding: '5px 12px' }}
                  onClick={() => {
                    onErase()
                    onClose()
                  }}
                >
                  Erase everything
                </button>
                <button className="link" style={{ fontSize: 12 }} onClick={() => setConfirmErase(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button className="link" style={{ color: 'var(--qvac-muted)', fontSize: 12 }} onClick={() => setConfirmErase(true)}>
                Erase everything on this device →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
