// ============================================================
// First launch, in two steps.
//
// It used to be one screen carrying the profile pills, the model download
// and the import button at once. Three unrelated decisions competing for the
// same moment, and the profile lost every time: people went straight for
// Import, the screen was replaced, and the age and gender fields were gone
// before they had been read. The app then apologised for that by popping a
// profile dialog over the freshly imported table.
//
// So: say who you are, then bring your results. Two steps, each with one
// thing to do, and the second one cannot be reached by accident.
// ============================================================

import { useState } from 'react'
import type { AgeGroup, AppState, Gender, ModelProgress, Profile } from '@shared/types.js'
import { AGE_GROUPS } from '@shared/ranges.js'
import { Chrome } from '../components/Chrome.js'
import { Download, Female, Lock, Male, Person } from '../components/Icons.js'

type Step = 'profile' | 'import'

export function WelcomeScreen({
  state,
  progress,
  busy,
  onImport,
  onLoadSample,
  onEnsureModel,
  onProfile
}: {
  state: AppState
  progress: ModelProgress | null
  busy: boolean
  onImport: () => void
  onLoadSample: () => void
  onEnsureModel: () => void
  onProfile: (p: Profile) => void
}): React.JSX.Element {
  // Someone who already gave a profile and then erased their data should not
  // be asked again, so the step they land on follows what is already known.
  const known = state.profile.ageGroup != null || state.profile.gender != null
  const [step, setStep] = useState<Step>(known ? 'import' : 'profile')
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(state.profile.ageGroup)
  const [gender, setGender] = useState<Gender | null>(state.profile.gender)

  const save = (next: { ageGroup?: AgeGroup | null; gender?: Gender | null }): void => {
    const merged: Profile = {
      weightKg: state.profile.weightKg,
      heightCm: state.profile.heightCm,
      ageGroup: next.ageGroup !== undefined ? next.ageGroup : ageGroup,
      gender: next.gender !== undefined ? next.gender : gender
    }
    if (next.ageGroup !== undefined) setAgeGroup(next.ageGroup)
    if (next.gender !== undefined) setGender(next.gender)
    onProfile(merged)
  }

  return (
    <>
      <Chrome model={state.model} />
      <div className="welcome">
        <div className="welcome-inner">
          <Steps step={step} />

          {step === 'profile' ? (
            <>
              <div className="welcome-mark">
                <Person size={34} color="#16E3C1" />
              </div>
              <h2>
                First, a little
                <br />
                <em>about you.</em>
              </h2>
              <p className="lead">
                Twelve of the 56 reference ranges are gender- or age-specific.
                <br />
                Tell us and those twelve adjust. Skip and they stay at baseline.
              </p>

              <div className="about-you">
                <div className="pill-row">
                  {AGE_GROUPS.map((g) => (
                    <button
                      key={g}
                      className={`pill ${ageGroup === g ? 'on' : ''}`}
                      onClick={() => save({ ageGroup: ageGroup === g ? null : g })}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <div className="pill-row">
                  <button
                    className={`pill ${gender === 'male' ? 'on' : ''}`}
                    onClick={() => save({ gender: gender === 'male' ? null : 'male' })}
                  >
                    <Male size={14} color={gender === 'male' ? '#0D0E0D' : '#7E8E88'} />
                    Male
                  </button>
                  <button
                    className={`pill ${gender === 'female' ? 'on' : ''}`}
                    onClick={() => save({ gender: gender === 'female' ? null : 'female' })}
                  >
                    <Female size={14} color={gender === 'female' ? '#0D0E0D' : '#7E8E88'} />
                    Female
                  </button>
                </div>
              </div>

              <div className="welcome-actions">
                <button className="btn primary big" onClick={() => setStep('import')}>
                  Continue
                </button>
                <button className="link" onClick={() => setStep('import')}>
                  Skip, use the baseline ranges →
                </button>
              </div>

              <div className="privacy-note">
                <Lock size={16} color="#16E3C1" />
                <span>This stays on your machine, like everything else here.</span>
              </div>
            </>
          ) : (
            <>
              <div className="welcome-mark">
                <Download size={34} color="#16E3C1" />
              </div>
              <h2>
                Now bring
                <br />
                <em>your results.</em>
              </h2>
              <p className="lead">
                Drop the file anywhere on this window, or pick it below.
                <br />
                Everything is read and scored here. Nothing is uploaded.
              </p>

              {!state.model.cached && (
                <div className="mini-profile" style={{ borderColor: 'var(--ok-line)' }}>
                  <div className="head">
                    {state.model.label} · {state.model.sizeLabel}
                  </div>
                  <div className="sub">
                    Needed for food suggestions and the chat. One download, then it works offline.
                  </div>
                  {progress && progress.phase !== 'ready' ? (
                    <>
                      <div style={{ height: 6, background: '#2A2C2A', borderRadius: 3, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${progress.percent}%`,
                            height: '100%',
                            background: 'var(--ok)',
                            transition: 'width .3s'
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--qvac-muted)', marginTop: 8 }}>
                        {progress.percent}% of {state.model.sizeLabel}
                      </div>
                    </>
                  ) : (
                    <button className="btn accent" onClick={onEnsureModel} disabled={busy}>
                      Download {state.model.sizeLabel}
                    </button>
                  )}
                </div>
              )}

              {/* A real target, not a caption. The whole window accepts a drop,
                  but a dashed rectangle is what makes anyone try it. */}
              <button className="drop-invite" onClick={onImport} disabled={busy}>
                <Download size={22} color="#16E3C1" />
                <b>Drop your results here</b>
                <span>A lab PDF, a bloodwork CSV, or a scale or ring export</span>
                <span className="or">or click to choose a file</span>
              </button>

              <div className="welcome-actions">
                <button className="link" onClick={onLoadSample} disabled={busy}>
                  No results to hand? Try the sample →
                </button>
                <button className="link dim" onClick={() => setStep('profile')}>
                  ← Back to your profile
                </button>
              </div>

              <div className="privacy-note">
                <Lock size={16} color="#16E3C1" />
                <span>Nothing leaves this device. No account, no upload, no cloud.</span>
              </div>
            </>
          )}

          <div className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
            An example and a prototype, provided as-is. Not a medical device.
          </div>
          {/* A credit, not a call to action. */}
          <img className="built-with" src="./built-with-qvac.svg" alt="Built with QVAC" />
        </div>
      </div>
    </>
  )
}

function Steps({ step }: { step: Step }): React.JSX.Element {
  return (
    <div className="steps" aria-label="Setup progress">
      <span className={`step ${step === 'profile' ? 'on' : 'done'}`}>1 About you</span>
      <span className="step-line" />
      <span className={`step ${step === 'import' ? 'on' : ''}`}>2 Your results</span>
    </div>
  )
}
