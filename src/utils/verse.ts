import type { PreparedVerse, VerseRecord, VerseWord } from '../types'

export function clampIndex(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function splitVerseIntoWords(arabic: string): VerseWord[] {
  return arabic
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((text, index) => ({
      id: `word-${index + 1}`,
      text,
    }))
}

export function prepareVerseRecords(records: VerseRecord[]): PreparedVerse[] {
  return records.map((record) => ({
    record,
    words: splitVerseIntoWords(record.arabic),
  }))
}

export function formatVerseLabel(record: VerseRecord) {
  return `${record.surahName} ${record.ayahNumber} (${record.surahNumber}:${record.ayahNumber})`
}
