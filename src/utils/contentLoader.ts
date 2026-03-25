import { SURAH_METADATA_BY_NUMBER } from '../data/surahMetadata'
import type { HadithRecord, VerseRecord } from '../types'

const QURAN_ARABIC_URL = new URL('../../Quran/quran-uthmani.txt', import.meta.url).href
const QURAN_ENGLISH_URL = new URL('../../Quran/en.qarai.txt', import.meta.url).href
const HADITH_URLS = [
  new URL('../../Hadith/mizan_al_hikmah_vol1.json', import.meta.url).href,
  new URL('../../Hadith/mizan_al_hikmah_vol2.json', import.meta.url).href,
  new URL('../../Hadith/mizan_al_hikmah_vol3.json', import.meta.url).href,
  new URL('../../Hadith/mizan_al_hikmah_vol4.json', import.meta.url).href,
]

interface ParsedQuranLine {
  surahNumber: number
  ayahNumber: number
  text: string
}

interface MizanHadithItem {
  hadith_num: number
  english: string
}

interface MizanSection {
  section_num: number
  section_title_en: string
  hadiths: MizanHadithItem[]
}

interface MizanChapter {
  chapter_num: number
  chapter_title_en: string
  sections: MizanSection[]
}

function parseQuranText(rawText: string): ParsedQuranLine[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [surahValue, ayahValue, ...textParts] = line.split('|')

      return {
        surahNumber: Number(surahValue),
        ayahNumber: Number(ayahValue),
        text: textParts.join('|').trim(),
      }
    })
}

function buildVerseId(surahNumber: number, ayahNumber: number) {
  return `${surahNumber}:${ayahNumber}`
}

function normalizeHadithText(english: string) {
  return english.replace(/^\s*\d+\.\s*/, '').trim()
}

function splitHadithText(english: string, fallbackSource: string) {
  const normalized = normalizeHadithText(english)
  const commaIndex = normalized.indexOf(',')

  if (commaIndex === -1) {
    return {
      source: fallbackSource,
      text: normalized,
    }
  }

  const source = normalized.slice(0, commaIndex).trim()
  const text = normalized
    .slice(commaIndex + 1)
    .trim()
    .replace(/^["']+/, '')
    .replace(/["']+$/, '')

  return {
    source: source || fallbackSource,
    text: text || normalized,
  }
}

export async function loadQuranContent() {
  const [arabicResponse, englishResponse] = await Promise.all([
    fetch(QURAN_ARABIC_URL),
    fetch(QURAN_ENGLISH_URL),
  ])

  if (!arabicResponse.ok || !englishResponse.ok) {
    throw new Error("Unable to load the Qur'an text files.")
  }

  const [arabicText, englishText] = await Promise.all([
    arabicResponse.text(),
    englishResponse.text(),
  ])

  const arabicLines = parseQuranText(arabicText)
  const englishLines = parseQuranText(englishText)
  const englishLookup = new Map(
    englishLines.map((line) => [buildVerseId(line.surahNumber, line.ayahNumber), line.text]),
  )

  const verses: VerseRecord[] = arabicLines.map((line) => {
    const surahMeta = SURAH_METADATA_BY_NUMBER.get(line.surahNumber)

    return {
      id: buildVerseId(line.surahNumber, line.ayahNumber),
      surahNumber: line.surahNumber,
      surahName: surahMeta?.name ?? `Surah ${line.surahNumber}`,
      surahNameAr: surahMeta?.nameAr ?? '',
      ayahNumber: line.ayahNumber,
      arabic: line.text,
      english: englishLookup.get(buildVerseId(line.surahNumber, line.ayahNumber)) ?? '',
    }
  })

  return verses
}

export async function loadHadithContent() {
  const responses = await Promise.all(HADITH_URLS.map((url) => fetch(url)))
  if (responses.some((response) => !response.ok)) {
    throw new Error('Unable to load the hadith files.')
  }

  const volumes = (await Promise.all(
    responses.map((response) => response.json()),
  )) as MizanChapter[][]

  const hadiths: HadithRecord[] = []

  volumes.forEach((chapters, volumeIndex) => {
    chapters.forEach((chapter) => {
      chapter.sections.forEach((section) => {
        section.hadiths.forEach((hadith) => {
          const fallbackSource = `${chapter.chapter_title_en} - ${section.section_title_en}`
          const { source, text } = splitHadithText(hadith.english, fallbackSource)

          if (!text) return

          hadiths.push({
            id: `v${volumeIndex + 1}-c${chapter.chapter_num}-s${section.section_num}-h${hadith.hadith_num}`,
            text,
            source,
            book: `Mizan al-Hikmah Vol. ${volumeIndex + 1}`,
          })
        })
      })
    })
  })

  return hadiths
}
