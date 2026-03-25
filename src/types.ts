export type CameraStatus = 'idle' | 'loading' | 'live' | 'denied' | 'error'

export interface VerseRecord {
  id: string
  surahNumber: number
  surahName: string
  surahNameAr: string
  ayahNumber: number
  arabic: string
  english: string
}

export interface VerseWord {
  id: string
  text: string
}

export interface PreparedVerse {
  record: VerseRecord
  words: VerseWord[]
}

export interface HadithRecord {
  id: string
  text: string
  source: string
  book: string
}

export interface StreamSettings {
  showHadith: boolean
  selectedVerseId: string
  activeWordIndex: number
  cameraDeviceId?: string
}
