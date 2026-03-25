import { useEffect, useRef, useState } from 'react'
import type { CameraStatus } from '../types'

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

async function listVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((device) => device.kind === 'videoinput')
}

export function useCameraFeed(selectedDeviceId?: string) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(
    selectedDeviceId,
  )
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return

    async function refreshDeviceList() {
      try {
        const nextDevices = await listVideoDevices()
        setDevices(nextDevices)
      } catch {
        setDevices([])
      }
    }

    void refreshDeviceList()
    navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList)

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDeviceList)
    }
  }, [])

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError('This browser does not expose webcam access.')
      return
    }

    let cancelled = false

    async function startFeed() {
      setStatus('loading')
      setError(null)

      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: selectedDeviceId
            ? {
                deviceId: { exact: selectedDeviceId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              }
            : {
                facingMode: 'user',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
          audio: false,
        })

        if (cancelled) {
          stopStream(nextStream)
          return
        }

        stopStream(streamRef.current)
        streamRef.current = nextStream
        setStream(nextStream)
        setStatus('live')

        const nextDevices = await listVideoDevices()
        if (!cancelled) {
          setDevices(nextDevices)
        }

        const nextActiveDeviceId = nextStream.getVideoTracks()[0]?.getSettings().deviceId
        setActiveDeviceId(nextActiveDeviceId || selectedDeviceId)
      } catch (errorValue) {
        if (cancelled) return

        stopStream(streamRef.current)
        streamRef.current = null
        setStream(null)

        if (errorValue instanceof DOMException && errorValue.name === 'NotAllowedError') {
          setStatus('denied')
          setError('Allow webcam access in the browser to show the live background.')
        } else if (
          errorValue instanceof DOMException &&
          (errorValue.name === 'NotFoundError' || errorValue.name === 'OverconstrainedError')
        ) {
          setStatus('error')
          setError('No matching camera is currently available.')
        } else {
          setStatus('error')
          setError('The camera feed could not be started.')
        }
      }
    }

    void startFeed()

    return () => {
      cancelled = true
    }
  }, [selectedDeviceId])

  useEffect(() => {
    return () => {
      stopStream(streamRef.current)
    }
  }, [])

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return

    try {
      const nextDevices = await listVideoDevices()
      setDevices(nextDevices)
    } catch {
      setDevices([])
    }
  }

  return {
    devices,
    stream,
    status,
    error,
    activeDeviceId,
    refreshDevices,
  }
}
