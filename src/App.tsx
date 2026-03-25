import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent, WheelEvent } from 'react'
import {
  BookOpen,
  Camera,
  CameraOff,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  PanelRightOpen,
  RefreshCw,
} from 'lucide-react'
import { useCameraFeed } from './hooks/useCameraFeed'
import type { HadithRecord, PreparedVerse, StreamSettings } from './types'
import { loadHadithContent, loadQuranContent } from './utils/contentLoader'
import { clampIndex, formatVerseLabel, prepareVerseRecords } from './utils/verse'

const STORAGE_KEY = 'desktopagent-stream-settings-v1'
const DEFAULT_SETTINGS: StreamSettings = {
  showHadith: true,
  selectedVerseId: '',
  activeWordIndex: 0,
}
const STAGE_WIDTH = 1080
const STAGE_HEIGHT = 1920
const STAGE_PADDING = 48
const HADITH_ROTATION_MS = 12000

function loadSettings(): StreamSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS

    const parsed = JSON.parse(raw) as Partial<StreamSettings>

    return {
      showHadith:
        typeof parsed.showHadith === 'boolean'
          ? parsed.showHadith
          : DEFAULT_SETTINGS.showHadith,
      selectedVerseId:
        typeof parsed.selectedVerseId === 'string'
          ? parsed.selectedVerseId
          : DEFAULT_SETTINGS.selectedVerseId,
      activeWordIndex: Number.isInteger(parsed.activeWordIndex)
        ? parsed.activeWordIndex!
        : DEFAULT_SETTINGS.activeWordIndex,
      cameraDeviceId:
        typeof parsed.cameraDeviceId === 'string' && parsed.cameraDeviceId.length > 0
          ? parsed.cameraDeviceId
          : undefined,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-control-surface="true"]'))
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  const tagName = target.tagName
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    tagName === 'BUTTON'
  )
}

function getCameraStatusLabel(status: ReturnType<typeof useCameraFeed>['status']) {
  switch (status) {
    case 'loading':
      return 'Connecting camera'
    case 'live':
      return 'Camera live'
    case 'denied':
      return 'Camera denied'
    case 'error':
      return 'Camera unavailable'
    default:
      return 'Camera idle'
  }
}

export default function App() {
  const [settings, setSettings] = useState<StreamSettings>(() => loadSettings())
  const [verses, setVerses] = useState<PreparedVerse[]>([])
  const [hadithEntries, setHadithEntries] = useState<HadithRecord[]>([])
  const [contentStatus, setContentStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [contentError, setContentError] = useState<string | null>(null)
  const [currentHadithIndex, setCurrentHadithIndex] = useState(0)
  const [stageScale, setStageScale] = useState(1)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const {
    devices,
    stream,
    status: cameraStatus,
    error: cameraError,
    activeDeviceId,
    refreshDevices,
  } = useCameraFeed(settings.cameraDeviceId)

  const verseMap = useMemo(
    () => new Map(verses.map((verse) => [verse.record.id, verse])),
    [verses],
  )

  const currentVerse = useMemo<PreparedVerse | null>(() => {
    if (verses.length === 0) return null
    return verseMap.get(settings.selectedVerseId) ?? verses[0]
  }, [verseMap, verses, settings.selectedVerseId])

  const currentVersePosition = useMemo(() => {
    if (!currentVerse) return -1
    return verses.findIndex((verse) => verse.record.id === currentVerse.record.id)
  }, [currentVerse, verses])

  const availableSurahs = useMemo(() => {
    const surahs = new Map<number, { name: string; nameAr: string }>()
    verses.forEach((verse) => {
      if (!surahs.has(verse.record.surahNumber)) {
        surahs.set(verse.record.surahNumber, {
          name: verse.record.surahName,
          nameAr: verse.record.surahNameAr,
        })
      }
    })

    return Array.from(surahs, ([number, value]) => ({
      number,
      name: value.name,
      nameAr: value.nameAr,
    }))
  }, [verses])

  const selectedSurahNumber =
    currentVerse?.record.surahNumber ?? availableSurahs[0]?.number ?? 1

  const ayahsForSelectedSurah = useMemo(
    () => verses.filter((verse) => verse.record.surahNumber === selectedSurahNumber),
    [selectedSurahNumber, verses],
  )

  const maxWordIndex = currentVerse ? currentVerse.words.length - 1 : 0
  const activeWordIndex = clampIndex(settings.activeWordIndex, 0, maxWordIndex)
  const currentHadith =
    hadithEntries.length > 0
      ? hadithEntries[currentHadithIndex % hadithEntries.length]
      : null
  const cameraAvailable = cameraStatus === 'live' && Boolean(stream)

  function updateSettings(updater: (previous: StreamSettings) => StreamSettings) {
    setSettings((previous) => updater(previous))
  }

  function moveToNextWord() {
    if (!currentVerse) return

    updateSettings((previous) => {
      if (previous.activeWordIndex < maxWordIndex) {
        return {
          ...previous,
          activeWordIndex: previous.activeWordIndex + 1,
        }
      }

      const nextVerse = verses[currentVersePosition + 1]
      if (!nextVerse) {
        return {
          ...previous,
          activeWordIndex: maxWordIndex,
        }
      }

      return {
        ...previous,
        selectedVerseId: nextVerse.record.id,
        activeWordIndex: 0,
      }
    })
  }

  function moveToPreviousWord() {
    if (!currentVerse) return

    updateSettings((previous) => {
      if (previous.activeWordIndex > 0) {
        return {
          ...previous,
          activeWordIndex: previous.activeWordIndex - 1,
        }
      }

      const previousVerse = verses[currentVersePosition - 1]
      if (!previousVerse) {
        return {
          ...previous,
          activeWordIndex: 0,
        }
      }

      return {
        ...previous,
        selectedVerseId: previousVerse.record.id,
        activeWordIndex: previousVerse.words.length - 1,
      }
    })
  }

  function resetCurrentVerse() {
    updateSettings((previous) => ({
      ...previous,
      activeWordIndex: 0,
    }))
  }

  useEffect(() => {
    let cancelled = false

    async function hydrateContent() {
      setContentStatus('loading')
      setContentError(null)

      try {
        const [quranRecords, hadithRecords] = await Promise.all([
          loadQuranContent(),
          loadHadithContent(),
        ])

        if (cancelled) return

        const preparedVerses = prepareVerseRecords(quranRecords)
        const preparedVerseMap = new Map(
          preparedVerses.map((verse) => [verse.record.id, verse]),
        )

        setVerses(preparedVerses)
        setHadithEntries(hadithRecords)
        setContentStatus('ready')

        setSettings((previous) => {
          const fallbackVerse = preparedVerses[0]
          const selectedVerse =
            preparedVerseMap.get(previous.selectedVerseId) ?? fallbackVerse

          if (!selectedVerse) {
            return previous
          }

          return {
            ...previous,
            selectedVerseId: selectedVerse.record.id,
            activeWordIndex: clampIndex(
              previous.activeWordIndex,
              0,
              selectedVerse.words.length - 1,
            ),
          }
        })
      } catch (errorValue) {
        if (cancelled) return

        setVerses([])
        setHadithEntries([])
        setContentStatus('error')
        setContentError(
          errorValue instanceof Error
            ? errorValue.message
            : 'The Qur’an and hadith files could not be loaded.',
        )
      }
    }

    void hydrateContent()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    function handleResize() {
      setStageScale(
        Math.min(
          Math.max(window.innerWidth - STAGE_PADDING, 320) / STAGE_WIDTH,
          Math.max(window.innerHeight - STAGE_PADDING, 640) / STAGE_HEIGHT,
          1,
        ),
      )
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (settings.activeWordIndex === activeWordIndex) return

    setSettings((previous) => ({
      ...previous,
      activeWordIndex,
    }))
  }, [activeWordIndex, settings.activeWordIndex])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    if (!activeDeviceId || activeDeviceId === settings.cameraDeviceId) return

    setSettings((previous) => ({
      ...previous,
      cameraDeviceId: activeDeviceId,
    }))
  }, [activeDeviceId, settings.cameraDeviceId])

  useEffect(() => {
    if (!settings.showHadith || hadithEntries.length <= 1) return

    const intervalId = window.setInterval(() => {
      setCurrentHadithIndex((previous) => (previous + 1) % hadithEntries.length)
    }, HADITH_ROTATION_MS)

    return () => window.clearInterval(intervalId)
  }, [hadithEntries.length, settings.showHadith])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveToNextWord()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveToPreviousWord()
      } else if (event.key === ' ') {
        event.preventDefault()
        resetCurrentVerse()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentVerse, maxWordIndex])

  function handleStageClick(event: MouseEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) return
    moveToNextWord()
  }

  function handleStageContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) return
    event.preventDefault()
    moveToPreviousWord()
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) return
    event.preventDefault()

    if (event.deltaY > 0) {
      moveToNextWord()
    } else if (event.deltaY < 0) {
      moveToPreviousWord()
    }
  }

  function handleSurahChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextSurahNumber = Number(event.target.value)
    const nextVerse = verses.find((verse) => verse.record.surahNumber === nextSurahNumber)

    if (!nextVerse) return

    setSettings((previous) => ({
      ...previous,
      selectedVerseId: nextVerse.record.id,
      activeWordIndex: 0,
    }))
  }

  function handleAyahChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextVerseId = event.target.value

    setSettings((previous) => ({
      ...previous,
      selectedVerseId: nextVerseId,
      activeWordIndex: 0,
    }))
  }

  function handleCameraChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCameraId = event.target.value

    setSettings((previous) => ({
      ...previous,
      cameraDeviceId: nextCameraId || undefined,
    }))
  }

  return (
    <main className="app-shell">
      <div className="stage-shell">
        <div
          className="stage-frame"
          style={{
            width: STAGE_WIDTH * stageScale,
            height: STAGE_HEIGHT * stageScale,
          }}
        >
          <div
            className="stream-stage"
            style={{
              width: STAGE_WIDTH,
              height: STAGE_HEIGHT,
              transform: `scale(${stageScale})`,
            }}
            onClick={handleStageClick}
            onContextMenu={handleStageContextMenu}
            onWheel={handleStageWheel}
          >
            <div className="camera-layer" aria-hidden="true">
              {cameraAvailable ? (
                <video
                  ref={videoRef}
                  className="camera-video"
                  autoPlay
                  muted
                  playsInline
                />
              ) : (
                <div className="camera-fallback">
                  <div className="camera-fallback__glow" />
                  <div className="camera-fallback__content">
                    {cameraStatus === 'denied' || cameraStatus === 'error' ? (
                      <CameraOff size={140} strokeWidth={1.2} />
                    ) : (
                      <Camera size={140} strokeWidth={1.2} />
                    )}
                    <p>{getCameraStatusLabel(cameraStatus)}</p>
                    {cameraError ? <span>{cameraError}</span> : null}
                  </div>
                </div>
              )}
              <div className="camera-vignette" />
              <div className="camera-noise" />
              <div className="camera-top-gradient" />
              <div className="camera-bottom-gradient" />
            </div>

            <div className="stage-content">
              {currentVerse ? (
                <section className="verse-display">
                  <div className="surah-chip">
                    <BookOpen size={20} />
                    <span className="surah-chip__latin">{currentVerse.record.surahName}</span>
                    <span className="surah-chip__divider" />
                    <span className="surah-chip__arabic" dir="rtl" lang="ar">
                      {currentVerse.record.surahNameAr}
                    </span>
                    <span className="surah-chip__divider" />
                    <span>Ayah {currentVerse.record.ayahNumber}</span>
                  </div>

                  <div className="arabic-verse" dir="rtl" lang="ar">
                    {currentVerse.words.map((word, index) => (
                      <span key={word.id} className="verse-token">
                        <span
                          className={
                            index === activeWordIndex ? 'verse-word is-active' : 'verse-word'
                          }
                        >
                          {word.text}
                        </span>
                        {index < currentVerse.words.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </div>

                  <p className="english-translation">
                    {currentVerse.record.english || 'Translation unavailable for this ayah.'}
                  </p>

                  <div className="stream-meta">
                    <span>
                      Word {activeWordIndex + 1} / {currentVerse.words.length}
                    </span>
                    <span>{formatVerseLabel(currentVerse.record)}</span>
                  </div>
                </section>
              ) : (
                <section className="verse-display verse-display--loading">
                  <div className="surah-chip">
                    <BookOpen size={20} />
                    <span>Preparing Library</span>
                  </div>
                  <p className="loading-copy">
                    {contentStatus === 'loading'
                      ? 'Loading the Qur’an and hadith files you added...'
                      : contentError || 'The content library is unavailable right now.'}
                  </p>
                </section>
              )}

              {settings.showHadith && currentHadith ? (
                <aside className="hadith-panel">
                  <div className="hadith-panel__accent" />
                  <div className="hadith-panel__label">Reflection</div>
                  <p className="hadith-panel__text">"{currentHadith.text}"</p>
                  <div className="hadith-panel__meta">
                    <span>{currentHadith.source}</span>
                    <span>{currentHadith.book}</span>
                  </div>
                </aside>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <aside className="control-dock" data-control-surface="true">
        <div className="control-dock__handle">
          <PanelRightOpen size={18} />
          <span>Controls</span>
        </div>

        <div className="control-dock__panel">
          <div className="dock-header">
            <h1>Live Controls</h1>
            <p>Hidden off the stream stage, ready from the desktop edge.</p>
          </div>

          <div className="dock-status-grid">
            <div className={`dock-pill status-${cameraStatus}`}>
              <span className="status-dot" />
              <span>{getCameraStatusLabel(cameraStatus)}</span>
            </div>
            <div className={`dock-pill status-${contentStatus === 'error' ? 'error' : 'live'}`}>
              <span className="status-dot" />
              <span>
                {contentStatus === 'loading'
                  ? 'Loading library'
                  : contentStatus === 'error'
                    ? 'Library error'
                    : `${verses.length} ayahs loaded`}
              </span>
            </div>
          </div>

          <label className="control-field">
            <span>Surah</span>
            <select
              value={selectedSurahNumber}
              onChange={handleSurahChange}
              disabled={verses.length === 0}
            >
              {availableSurahs.map((surah) => (
                <option key={surah.number} value={surah.number}>
                  {`${surah.number}. ${surah.name} (${surah.nameAr})`}
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>Ayah</span>
            <select
              value={currentVerse?.record.id ?? ''}
              onChange={handleAyahChange}
              disabled={ayahsForSelectedSurah.length === 0}
            >
              {ayahsForSelectedSurah.map((verse) => (
                <option key={verse.record.id} value={verse.record.id}>
                  {`Ayah ${verse.record.ayahNumber}`}
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>Camera</span>
            <select value={settings.cameraDeviceId ?? ''} onChange={handleCameraChange}>
              <option value="">Default camera</option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>

          <div className="dock-actions">
            <button type="button" className="icon-button" onClick={moveToPreviousWord}>
              <ChevronLeft size={18} />
              <span>Previous</span>
            </button>
            <button type="button" className="icon-button" onClick={resetCurrentVerse}>
              <RefreshCw size={18} />
              <span>Reset</span>
            </button>
            <button type="button" className="icon-button" onClick={moveToNextWord}>
              <span>Next</span>
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="dock-actions dock-actions--secondary">
            <button
              type="button"
              className="icon-button"
              onClick={() =>
                setSettings((previous) => ({
                  ...previous,
                  showHadith: !previous.showHadith,
                }))
              }
            >
              {settings.showHadith ? <Eye size={18} /> : <EyeOff size={18} />}
              <span>{settings.showHadith ? 'Hide hadith' : 'Show hadith'}</span>
            </button>

            <button type="button" className="icon-button" onClick={refreshDevices}>
              <RefreshCw size={18} />
              <span>Refresh cameras</span>
            </button>
          </div>

          <div className="dock-notes">
            <p>
              Scroll or click directly on the stage for live stepping. The dock stays off the
              stream canvas until you hover or focus it. Reaching the last word now moves into
              the next ayah automatically.
            </p>
            {contentError ? <p className="dock-notes__error">{contentError}</p> : null}
          </div>
        </div>
      </aside>
    </main>
  )
}
